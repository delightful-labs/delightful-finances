import { glob, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { closeCreationModal, creationDialog, openCreationModal } from './helpers/ui.js'

async function prepareShell(page: Page) {
	await page.goto('/accounts')
	await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready
	})
	await page.reload()
	await expect
		.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
		.toBe(true)
}

test('precaches emitted worker Wasm and serves it without the HTTP cache', async ({
	page,
	context
}) => {
	await prepareShell(page)
	const clientRoot = '.svelte-kit/output/client'
	const requiredPaths: string[] = []
	for await (const file of glob(`${clientRoot}/_app/immutable/**/*.wasm`)) {
		requiredPaths.push(`/${relative(clientRoot, file).split(sep).join('/')}`)
	}
	expect(requiredPaths.length).toBeGreaterThan(0)
	const cachedPaths = await page.evaluate(async () => {
		const names = (await caches.keys()).filter((name) =>
			name.startsWith('delightful-finance-shell-')
		)
		const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()))
		return requests.flat().map((request) => new URL(request.url).pathname)
	})
	expect(cachedPaths).toEqual(expect.arrayContaining(requiredPaths))
	const cdp = await context.newCDPSession(page)
	await cdp.send('Network.enable')
	await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
	await context.setOffline(true)
	for (const path of requiredPaths) {
		const responsePromise = page.waitForResponse(
			(response) => new URL(response.url()).pathname === path
		)
		const header = await page.evaluate(async (path) => {
			const response = await fetch(path, { cache: 'no-store' })
			return {
				status: response.status,
				magic: [...new Uint8Array(await response.arrayBuffer()).slice(0, 4)]
			}
		}, path)
		expect((await responsePromise).fromServiceWorker()).toBe(true)
		expect(header).toEqual({ status: 200, magic: [0, 97, 115, 109] })
	}
})

test('reopens a saved account offline after the browser and database worker exit', async ({
	playwright,
	baseURL,
	browserName
}) => {
	test.skip(browserName !== 'chromium', 'HTTP-cache isolation uses Chromium CDP')
	test.setTimeout(90_000)
	if (!baseURL) throw new Error('Expected production preview URL')
	const profile = await mkdtemp(join(tmpdir(), 'delightful-finance-cold-start-'))
	let current: BrowserContext | undefined
	try {
		current = await playwright.chromium.launchPersistentContext(profile, {
			baseURL,
			serviceWorkers: 'allow'
		})
		const warm = current.pages()[0] ?? (await current.newPage())
		await prepareShell(warm)
		await openCreationModal(warm, 'Add Account')
		const dialog = creationDialog(warm, 'Add Account')
		await dialog.getByLabel('Account name').fill('Cold runtime ledger')
		await dialog.getByLabel('Account type').selectOption('cash')
		await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
		await expect(dialog.getByRole('status')).toContainText('Cold runtime ledger')
		await closeCreationModal(warm)
		await expect(warm.getByRole('cell', { name: 'Cold runtime ledger', exact: true })).toBeVisible()
		const url = new URL(warm.url())
		const route = `${url.pathname}${url.search}`
		const cdp = await current.newCDPSession(warm)
		await cdp.send('Network.enable')
		// Preserve Cache Storage, localStorage and IndexedDB; remove the HTTP-cache fallback.
		await cdp.send('Network.clearBrowserCache')
		// Closing a persistent context exits its browser, including its SharedWorker runtime.
		await current.close()
		current = undefined
		current = await playwright.chromium.launchPersistentContext(profile, {
			baseURL,
			serviceWorkers: 'allow',
			offline: true
		})
		const cold = current.pages()[0] ?? (await current.newPage())
		const errors: string[] = []
		cold.on('pageerror', (error) => errors.push(error.message))
		const response = await cold.goto(route)
		expect(response?.fromServiceWorker()).toBe(true)
		await expect(cold.getByRole('cell', { name: 'Cold runtime ledger', exact: true })).toBeVisible({
			timeout: 30_000
		})
		expect(errors).toEqual([])
	} finally {
		await current?.close()
		await rm(profile, { recursive: true, force: true })
	}
})
