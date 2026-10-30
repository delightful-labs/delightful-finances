import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test'
import { startLocalJazzServer, type LocalJazzServerHandle } from 'jazz-tools/testing'
import { createJazzSession, type Db } from 'jazz-tools/backend'
import { app } from '../src/lib/schema.js'
import permissions from '../src/lib/permissions.js'
import { createSilentJazzProxy } from './helpers/silent-jazz-proxy.js'
import {
	closeCreationModal,
	creationDialog,
	openCreationModal,
	navigateSidebar
} from './helpers/ui.js'

const test = base.extend<{
	remote: ReturnType<typeof createSilentJazzProxy> & { backend: LocalJazzServerHandle }
	authority: Db
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
				await use({ ...proxy, backend })
			} finally {
				await proxy.close()
			}
		} finally {
			await backend.stop()
		}
	},
	authority: async ({ remote }, use) => {
		const session = await createJazzSession({
			appId: remote.backend.appId,
			app,
			permissions,
			driver: { type: 'memory' },
			serverUrl: remote.backend.url,
			initial: { backendSecret: remote.backend.backendSecret },
			env: 'test'
		})
		try {
			const client = session.getSnapshot().client
			if (!client) throw new Error('Expected backend authority client')
			await use(client.db)
		} finally {
			await session.close()
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

async function prepareSavedExpense(page: Page) {
	await page.goto('/accounts')
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready
	})
	await page.reload()
	await expect(page).toHaveURL(/\/accounts\?workspace=[a-f0-9-]+$/)
	await openCreationModal(page, 'Add Account')
	const dialog = creationDialog(page, 'Add Account')
	await dialog.getByLabel('Account name').fill('Silent remote ledger')
	await dialog.getByLabel('Account type').selectOption('cash')
	await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
	await expect(dialog.getByRole('status')).toContainText('Silent remote ledger')
	await closeCreationModal(page)
	const workspace = new URL(page.url()).searchParams.get('workspace')
	if (!workspace) throw new Error('Expected scoped workspace')
	await page.goto(`/expenses/new?workspace=${workspace}`)
	await page
		.getByLabel('Account', { exact: true })
		.selectOption({ label: 'Silent remote ledger · USD' })
	await page.getByLabel('Amount', { exact: true }).fill('12.34')
	await page.getByLabel('Date', { exact: true }).fill('2026-03-10')
	await page.getByLabel('Description', { exact: true }).fill('Silent remote saved record')
	await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
	const link = page
		.getByRole('main')
		.getByRole('link', { name: /Transaction details:.*Silent remote saved record/ })
	await expect(link).toBeVisible()
	const target = await link.getAttribute('href')
	if (!target) throw new Error('Expected saved detail URL')
	await page.goto(target)
	await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('12.34')
	const transactionId = new URL(target, page.url()).pathname.split('/').at(-1)
	if (!transactionId) throw new Error('Expected transaction ID')
	return { target, workspace, transactionId }
}

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
		const { target } = await prepareSavedExpense(warm)
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
		await navigateSidebar(cold, 'Accounts')
		const accountDialog = await openCreationModal(cold, 'Add Account')
		await accountDialog.getByLabel('Account name').fill('Cold local cash')
		await accountDialog.getByLabel('Account type').selectOption('cash')
		await accountDialog.getByRole('button', { name: 'Add Account', exact: true }).click()
		await expect(accountDialog.getByRole('status')).toContainText('Cold local cash')
		await closeCreationModal(cold)
		await cold.reload()
		await expect(
			cold.getByRole('main').getByRole('cell', { name: 'Cold local cash', exact: true })
		).toBeVisible()
		expect(errors).toEqual([])
	} finally {
		await current?.close()
	}
})

test('local saves continue when a fully negotiated connection stops answering', async ({
	playwright,
	baseURL,
	remote,
	authority,
	profile
}) => {
	if (!baseURL) throw new Error('Expected production preview URL')
	const context = await playwright.chromium.launchPersistentContext(profile, { baseURL })
	try {
		const page = context.pages()[0] ?? (await context.newPage())
		const { transactionId } = await prepareSavedExpense(page)
		const query = app.transactions.where({ id: transactionId })
		await expect
			.poll(async () => (await authority.one(query, { tier: 'remote' }))?.amountMinor)
			.toBe(1234)
		remote.pauseEstablished()
		await page.getByLabel('Amount', { exact: true }).fill('42.13')
		await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await expect(
			page.getByRole('status').filter({ hasText: /^Transaction saved\.$/ })
		).toBeVisible()
		expect((await authority.one(query, { tier: 'remote' }))?.amountMinor).toBe(1234)
		expect(await page.evaluate(() => navigator.onLine)).toBe(true)
		remote.resume()
		await expect
			.poll(async () => (await authority.one(query, { tier: 'remote' }))?.amountMinor)
			.toBe(4213)
	} finally {
		await context.close()
	}
})

test('reports a real server rejection after a locally successful save with stale write access', async ({
	playwright,
	baseURL,
	remote,
	authority,
	profile
}) => {
	if (!baseURL) throw new Error('Expected isolated production preview URL')
	const context = await playwright.chromium.launchPersistentContext(profile, {
		baseURL,
		serviceWorkers: 'allow'
	})
	try {
		const page = context.pages()[0] ?? (await context.newPage())
		const { workspace, transactionId, target } = await prepareSavedExpense(page)
		const transaction = app.transactions.where({ id: transactionId })
		// Establish the server's accepted baseline before changing authority.
		await expect
			.poll(async () => (await authority.one(transaction, { tier: 'remote' }))?.amountMinor)
			.toBe(1234)
		const members = await authority.all(
			app.organizationMembers.where({ organizationId: workspace }),
			{ tier: 'remote' }
		)
		expect(members).toHaveLength(1)
		const owner = members[0]
		if (!owner) throw new Error('Expected initial owner membership')
		expect(owner.role).toBe('owner')
		remote.silence()
		await authority
			.update(app.organizationMembers, owner.id, { role: 'viewer', accountAccessMode: 'all' })
			.wait({ tier: 'global' })
		await expect(page.getByLabel('Amount', { exact: true })).toBeEnabled()
		await page.getByLabel('Amount', { exact: true }).fill('42.13')
		await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await expect(
			page.getByRole('status').filter({ hasText: /^Transaction saved\.$/ })
		).toBeVisible()
		// Local success has not modified the serving authority's accepted record.
		expect((await authority.one(transaction, { tier: 'remote' }))?.amountMinor).toBe(1234)
		remote.resume()
		const notice = page
			.getByRole('status')
			.filter({ hasText: 'A change was rejected while syncing.' })
		await expect(notice).toBeVisible({ timeout: 30_000 })
		await expect(page.getByLabel('Amount', { exact: true })).toBeDisabled()
		await expect(page.getByRole('button', { name: 'Save Transaction', exact: true })).toHaveCount(0)
		expect((await authority.one(transaction, { tier: 'remote' }))?.amountMinor).toBe(1234)
		expect(
			(await authority.one(app.organizationMembers.where({ id: owner.id }), { tier: 'remote' }))
				?.role
		).toBe('viewer')
		await notice.getByRole('button', { name: 'Dismiss', exact: true }).click()
		await expect(notice).toHaveCount(0)
		await page.reload()
		await expect(page).toHaveURL(new URL(target, baseURL).href)
		await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('12.34')
		await expect(page.getByLabel('Amount', { exact: true })).toBeDisabled()
	} finally {
		await context.close()
	}
})
