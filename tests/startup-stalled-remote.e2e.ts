import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test as base, type BrowserContext } from '@playwright/test'
import { startLocalJazzServer } from 'jazz-tools/testing'
import { app } from '../src/lib/schema.js'
import permissions from '../src/lib/permissions.js'
import { createSilentJazzProxy } from './helpers/silent-jazz-proxy.js'
import { closeCreationModal, creationDialog, openCreationModal } from './helpers/ui.js'

const test = base.extend<{
	remote: ReturnType<typeof createSilentJazzProxy>
	profile: string
}>({
	remote: async ({}, use) => {
		const backend = await startLocalJazzServer({
			inMemory: true,
			appId: '77777777-7777-4777-8777-777777777777',
			schema: app,
			permissions
		})
		try {
			const proxy = createSilentJazzProxy(backend.url)
			try {
				await proxy.listen()
				await use(proxy)
			} finally {
				await proxy.close()
			}
		} finally {
			await backend.stop()
		}
	},
	profile: async ({}, use) => {
		const profile = await mkdtemp(join(tmpdir(), 'delightful-stalled-startup-'))
		try {
			await use(profile)
		} finally {
			await rm(profile, { recursive: true, force: true })
		}
	}
})

test('cold local reads and saves work while an open remote connection never answers', async ({
	playwright,
	browserName,
	baseURL,
	remote,
	profile
}) => {
	test.skip(browserName !== 'chromium', 'HTTP-cache isolation uses Chromium CDP')
	if (!baseURL) throw new Error('Expected isolated production preview URL')
	let current: BrowserContext | undefined
	try {
		current = await playwright.chromium.launchPersistentContext(profile, {
			baseURL,
			serviceWorkers: 'allow'
		})
		const warm = current.pages()[0] ?? (await current.newPage())
		await warm.goto('/accounts')
		await warm.evaluate(async () => {
			await navigator.serviceWorker.ready
		})
		await warm.reload()
		await expect(warm).toHaveURL(/\/accounts\?workspace=[a-f0-9-]+$/)
		await openCreationModal(warm, 'Add Account')
		const dialog = creationDialog(warm, 'Add Account')
		await dialog.getByLabel('Account name').fill('Silent remote ledger')
		await dialog.getByLabel('Account type').selectOption('cash')
		await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
		await expect(dialog.getByRole('status')).toContainText('Silent remote ledger')
		await closeCreationModal(warm)
		const workspace = new URL(warm.url()).searchParams.get('workspace')
		if (!workspace) throw new Error('Expected scoped workspace')
		await warm.goto(`/expenses/new?workspace=${workspace}`)
		await warm
			.getByLabel('Account', { exact: true })
			.selectOption({ label: 'Silent remote ledger · USD' })
		await warm.getByLabel('Amount', { exact: true }).fill('12.34')
		await warm.getByLabel('Date', { exact: true }).fill('2026-03-10')
		await warm.getByLabel('Description', { exact: true }).fill('Silent remote saved record')
		await warm.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		const link = warm
			.getByRole('main')
			.getByRole('link', { name: /Transaction details:.*Silent remote saved record/ })
		await expect(link).toBeVisible()
		const target = await link.getAttribute('href')
		if (!target) throw new Error('Expected saved detail URL')
		await warm.goto(target)
		await expect(warm.getByLabel('Amount', { exact: true })).toHaveValue('12.34')
		const cdp = await current.newCDPSession(warm)
		await cdp.send('Network.enable')
		await cdp.send('Network.clearBrowserCache')
		// Exit the browser and SharedWorker; preserve only the application profile data.
		await current.close()
		current = undefined
		remote.silence()
		current = await playwright.chromium.launchPersistentContext(profile, {
			baseURL,
			serviceWorkers: 'allow'
		})
		const cold = current.pages()[0] ?? (await current.newPage())
		const errors: string[] = []
		cold.on('pageerror', (error) => errors.push(error.message))
		const response = await cold.goto(target)
		expect(response?.fromServiceWorker()).toBe(true)
		await expect.poll(() => remote.observed.opened).toBeGreaterThan(0)
		await expect.poll(() => remote.observed.clientBytes).toBeGreaterThan(0)
		expect(await cold.evaluate(() => navigator.onLine)).toBe(true)
		await expect(cold.getByLabel('Amount', { exact: true })).toHaveValue('12.34')
		await expect(cold.getByLabel('Description', { exact: true })).toHaveValue(
			'Silent remote saved record'
		)
		await cold.getByLabel('Amount', { exact: true }).fill('42.13')
		await cold.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await expect(
			cold.getByRole('status').filter({ hasText: /^Transaction saved\.$/ })
		).toBeVisible()
		const reload = await cold.reload()
		expect(reload?.fromServiceWorker()).toBe(true)
		await expect(cold.getByLabel('Amount', { exact: true })).toHaveValue('42.13')
		await expect(cold).toHaveURL(new URL(target, baseURL).href)
		expect(errors).toEqual([])
	} finally {
		await current?.close()
	}
})
