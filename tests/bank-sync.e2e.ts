import { expect, test, type Page } from '@playwright/test'
import { openCreationModal } from './helpers/ui.js'

async function installPasskey(page: Page) {
	await page.addInitScript(() => {
		let assertions = 0
		class DemoCredential {
			rawId = new Uint8Array([1, 2, 3]).buffer
			getClientExtensionResults() {
				return { prf: { enabled: true, results: { first: new Uint8Array(32).fill(7).buffer } } }
			}
		}
		Object.defineProperty(window, 'PublicKeyCredential', {
			value: DemoCredential,
			configurable: true
		})
		Object.defineProperty(navigator, 'credentials', {
			configurable: true,
			value: {
				create: async () => new DemoCredential(),
				get: async () => {
					assertions += 1
					document.documentElement.dataset.assertions = String(assertions)
					return new DemoCredential()
				}
			}
		})
	})
}

test('relay rejects cross-origin requests and unsafe destinations', async ({
	request,
	baseURL
}) => {
	if (!baseURL) throw new Error('Expected test base URL')
	const forbidden = await request.post('/api/simplefin', {
		headers: { Origin: 'https://evil.example' },
		data: { operation: 'claim', url: 'https://evil.example' }
	})
	expect(forbidden.status()).toBe(403)
	const rejected = await request.post('/api/simplefin', {
		headers: { Origin: baseURL },
		data: { operation: 'claim', url: 'https://evil.example' }
	})
	expect(rejected.status()).toBe(502)
	expect(await rejected.json()).toEqual({ error: 'provider-failure' })
	expect(rejected.headers()['cache-control']).toBe('no-store')
})

test('connects explicitly, creates provider-named accounts once, and imports idempotently', async ({
	page
}) => {
	test.setTimeout(120_000)
	await installPasskey(page)
	const operations: string[] = []
	let failSync = false
	const org = { 'sfin-url': 'https://bank.example', domain: 'bank.example' }
	const checking = {
		id: 'checking',
		name: 'Provider Checking',
		currency: 'USD',
		balance: '100.00',
		'available-balance': '90.00',
		'balance-date': 1792000000,
		org
	}
	const savings = {
		id: 'savings',
		name: 'Provider Savings',
		currency: 'USD',
		balance: '200.00',
		'balance-date': 1792000000,
		org
	}
	await page.route('**/api/simplefin', async (route) => {
		const body: unknown = route.request().postDataJSON()
		if (
			!body ||
			typeof body !== 'object' ||
			!('operation' in body) ||
			typeof body.operation !== 'string'
		)
			throw new Error('Invalid operation')
		operations.push(body.operation)
		if (body.operation === 'sync' && failSync) {
			await route.fulfill({ status: 502, json: { error: 'provider-failure' } })
			return
		}
		if (body.operation === 'claim') {
			await route.fulfill({
				contentType: 'text/plain',
				body: 'https://test:synthetic@bridge.simplefin.org/simplefin'
			})
			return
		}
		await route.fulfill({
			json: {
				errors: [],
				accounts: [
					{
						...checking,
						transactions:
							body.operation === 'sync'
								? [
										{
											id: 'expense-1',
											amount: '-12.34',
											posted: 1792000000,
											description: 'Imported expense'
										},
										{
											id: 'income-1',
											amount: '100.00',
											posted: 1792000000,
											description: 'Imported income'
										},
										{
											id: 'pending-1',
											amount: '-1.00',
											posted: 1792000000,
											description: 'Pending',
											pending: true
										},
										{
											id: 'invalid-1',
											amount: '1.234',
											posted: 1792000000,
											description: 'Invalid precision'
										}
									]
								: undefined
					},
					savings
				]
			}
		})
	})
	await page.goto('/settings/banks')
	const input = page.locator('#simplefin-token')
	await expect(input).toBeVisible({ timeout: 30_000 })
	await expect(page.getByRole('button', { name: 'Discover Accounts', exact: true })).toHaveCount(0)
	await input.fill(btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token'))
	await page.getByRole('button', { name: 'Create Passkey', exact: true }).click()
	await page.getByRole('button', { name: 'Test encryption with my passkey', exact: true }).click()
	await page.getByRole('button', { name: 'Test unlocking with my passkey', exact: true }).click()
	await expect(
		page.getByRole('button', { name: 'Connect and save securely', exact: true })
	).toBeVisible()
	expect(operations).toEqual([])
	await page.getByRole('button', { name: 'Connect and save securely', exact: true }).click()
	const discover = page.getByRole('button', { name: 'Discover Accounts', exact: true })
	await expect(discover).toBeEnabled()
	expect(operations).toEqual(['claim'])
	await discover.click()
	const addChecking = page.getByRole('button', {
		name: 'Add Account “Provider Checking”',
		exact: true
	})
	await expect(addChecking).toBeEnabled()
	await expect(page.getByRole('combobox')).toHaveCount(0)
	await addChecking.click()
	await expect(page.getByText('Linked to Provider Checking', { exact: true })).toBeVisible()
	await expect(addChecking).toHaveCount(0)
	// The first linked account must never become a destination for savings.
	await expect(page.getByRole('combobox')).toHaveCount(0)
	await page.getByRole('button', { name: 'Add Account “Provider Savings”', exact: true }).click()
	await expect(page.getByText('Linked to Provider Savings', { exact: true })).toBeVisible()
	const sync = page
		.getByRole('main')
		.getByRole('button', { name: 'Sync now (last 90 days)', exact: true })
	await sync.click()
	await expect(page.getByText(/Imported: 2; already present: 0; omitted: 2/)).toBeVisible()
	const savedBalances = await page.evaluate(async () => {
		const schemaPath = '/src/lib/schema.ts',
			sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		const links = await db.all(app.simplefinAccountLinks)
		return links.map(({ availableBalance, balanceDate }) => ({
			availableBalance,
			balanceDate: balanceDate?.toISOString()
		}))
	})
	expect(savedBalances).toHaveLength(2)
	expect(savedBalances).toEqual(
		expect.arrayContaining([
			{ availableBalance: '200.00', balanceDate: new Date(1792000000 * 1000).toISOString() },
			{ availableBalance: '90.00', balanceDate: new Date(1792000000 * 1000).toISOString() }
		])
	)
	const edited = await page.evaluate(async () => {
		const schemaPath = '/src/lib/schema.ts',
			sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		const rows = await db.all(app.transactions.where({ source: 'simplefin' }))
		const row = rows.find((value) => value.kind === 'expense')
		if (!row) throw new Error('Missing imported expense')
		await db
			.update(app.transactions, row.id, {
				description: 'User description',
				memo: 'User notes',
				amountMinor: 5678
			})
			.wait({ tier: 'global' })
		return { id: row.id, externalId: row.externalId }
	})

	await sync.click()
	await expect(page.getByText(/Imported: 0; already present: 2; omitted: 2/)).toBeVisible()
	const afterRepeat = await page.evaluate(async (id) => {
		const schemaPath = '/src/lib/schema.ts',
			sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		const rows = await db.all(app.transactions.where({ source: 'simplefin' }), { tier: 'remote' })
		const row = rows.find((value) => value.id === id)
		return {
			count: rows.length,
			description: row?.description,
			memo: row?.memo,
			amountMinor: row?.amountMinor,
			externalId: row?.externalId
		}
	}, edited.id)
	expect(afterRepeat).toEqual({
		count: 2,
		description: 'User description',
		memo: 'User notes',
		amountMinor: 5678,
		externalId: edited.externalId
	})

	expect(operations).toEqual(['claim', 'discover', 'sync', 'sync'])
	await page.reload()
	await expect(discover).toBeEnabled()
	const savedHistory = page
		.getByRole('main')
		.getByText(/Last sync:.*Imported: 0; already present: 2; omitted: 2/)
	await expect(savedHistory).toBeVisible()
	expect(operations).toEqual(['claim', 'discover', 'sync', 'sync'])
	// A new discovery uses the current capability report without replacing saved sync history.
	await discover.click()
	await expect(page.getByText('Linked to Provider Checking', { exact: true })).toBeVisible()
	await expect(discover).toBeEnabled()
	await expect(savedHistory).toBeVisible()
	expect(operations).toEqual(['claim', 'discover', 'sync', 'sync', 'discover'])
	failSync = true
	await sync.click()
	await expect(
		page
			.getByRole('main')
			.getByRole('status')
			.filter({ hasText: 'SimpleFIN could not complete the request' })
	).toBeVisible()
	await expect(sync).toBeEnabled()
	expect(operations).toEqual(['claim', 'discover', 'sync', 'sync', 'discover', 'sync'])
	await page.getByRole('button', { name: 'Disconnect Bank sync', exact: true }).click()
	await expect(discover).toHaveCount(0)
	await expect(sync).toHaveCount(0)
})

test('lock actor startup failure clears setup and allows an explicit new attempt', async ({
	page
}) => {
	const errors: string[] = []
	const stoppedActorWarnings: string[] = []
	page.on('console', (message) => {
		if (message.text().includes('sent to stopped actor')) stoppedActorWarnings.push(message.text())
	})
	const providerRequests: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await installPasskey(page)
	await page.addInitScript(() => {
		const request = navigator.locks.request.bind(navigator.locks)
		let failed = false
		Object.defineProperty(navigator.locks, 'request', {
			configurable: true,
			value: (...args: Parameters<typeof request>) => {
				if (!failed && args[0].startsWith('simplefin:')) {
					failed = true
					throw new Error('Synthetic lock acquisition failure')
				}
				return request(...args)
			}
		})
	})
	await page.route('**/api/simplefin', async (route) => {
		providerRequests.push(route.request().url())
		await route.abort()
	})
	await page.goto('/settings/banks')
	const input = page.getByLabel('SimpleFIN Bridge setup token', { exact: true })
	const create = page.getByRole('button', { name: 'Create Passkey', exact: true })
	const token = btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token')
	await input.fill(token)
	await create.click()
	await expect(
		page.getByRole('main').getByRole('status').filter({ hasText: 'No automatic retry will occur' })
	).toBeVisible()
	await expect(input).toHaveValue('')
	await expect(create).toBeDisabled()
	await input.fill(token)
	await create.click()
	await expect(
		page.getByRole('button', { name: 'Test encryption with my passkey', exact: true })
	).toBeVisible()
	await page.getByRole('button', { name: 'Cancel', exact: true }).click()
	await expect(input).toHaveValue('')
	expect(providerRequests).toEqual([])
	expect(errors).toEqual([])
	expect(stoppedActorWarnings).toEqual([])
})

test('cancelled passkey creation ignores a late success and releases the bank lock', async ({
	page
}) => {
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await installPasskey(page)
	await page.addInitScript(() => {
		const create = navigator.credentials.create.bind(navigator.credentials)
		let release: (() => void) | undefined
		let delayed = false
		document.addEventListener('release-test-passkey', () => release?.())
		Object.defineProperty(navigator.credentials, 'create', {
			configurable: true,
			value: async (options: CredentialCreationOptions) => {
				if (!delayed) {
					delayed = true
					document.documentElement.dataset.passkeyPending = 'true'
					await new Promise<void>((resolve) => {
						release = resolve
					})
				}
				const credential = await create(options)
				document.documentElement.dataset.passkeySettled = 'true'
				return credential
			}
		})
	})
	await page.goto('/settings/banks')
	const input = page.getByLabel('SimpleFIN Bridge setup token', { exact: true })
	const create = page.getByRole('button', { name: 'Create Passkey', exact: true })
	const encrypt = page.getByRole('button', { name: 'Test encryption with my passkey', exact: true })
	const token = btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token')
	await input.fill(token)
	await create.click()
	await expect(page.locator('html')).toHaveAttribute('data-passkey-pending', 'true')
	await page.getByRole('button', { name: 'Cancel', exact: true }).click()
	await expect(input).toHaveValue('')
	await page.evaluate(() => document.dispatchEvent(new Event('release-test-passkey')))
	await expect(page.locator('html')).toHaveAttribute('data-passkey-settled', 'true')
	await expect(encrypt).toBeHidden()
	await input.fill(token)
	await create.click()
	await expect(encrypt).toBeVisible()
	await page.getByRole('button', { name: 'Cancel', exact: true }).click()
	await expect(input).toHaveValue('')
	expect(errors).toEqual([])
})

test('maps and remaps a provider account to existing accounts without creating duplicates', async ({
	page
}) => {
	await installPasskey(page)
	await page.goto('/accounts')
	for (const name of ['Existing checking', 'Replacement checking']) {
		const dialog = await openCreationModal(page, 'Add Account')
		await dialog.getByLabel('Account name', { exact: true }).fill(name)
		await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
		await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
		await expect(dialog.getByRole('status')).toContainText(name)
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(dialog).toBeHidden()
	}
	const operations: string[] = []
	await page.route('**/api/simplefin', async (route) => {
		const body: unknown = route.request().postDataJSON()
		if (
			!body ||
			typeof body !== 'object' ||
			!('operation' in body) ||
			typeof body.operation !== 'string'
		)
			throw new Error('Invalid provider command')
		operations.push(body.operation)
		if (body.operation === 'claim') {
			await route.fulfill({
				contentType: 'text/plain',
				body: 'https://test:synthetic@bridge.simplefin.org/simplefin'
			})
			return
		}
		await route.fulfill({
			json: {
				errors: [],
				accounts: [
					{
						id: 'existing-checking',
						name: 'Provider Checking',
						currency: 'USD',
						org: { domain: 'bank.example', 'sfin-url': 'https://bank.example' }
					}
				]
			}
		})
	})
	await page.goto('/settings/banks')
	await page
		.getByLabel('SimpleFIN Bridge setup token', { exact: true })
		.fill(btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token'))
	for (const name of [
		'Create Passkey',
		'Test encryption with my passkey',
		'Test unlocking with my passkey',
		'Connect and save securely'
	]) {
		await page.getByRole('button', { name, exact: true }).click()
	}
	const discover = page.getByRole('button', { name: 'Discover Accounts', exact: true })
	await expect(discover).toBeEnabled()
	await discover.click()
	const row = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Provider Checking' })
	const existing = row.getByRole('combobox', {
		name: 'Link to existing Account',
		exact: true
	})
	await existing.selectOption({ label: 'Existing checking' })
	await expect(row.getByText('Linked to Existing checking', { exact: true })).toBeVisible()
	await expect(
		row.getByRole('button', { name: 'Add Account “Provider Checking”', exact: true })
	).toHaveCount(0)
	await existing.selectOption({ label: 'Replacement checking' })
	await expect(row.getByText('Linked to Replacement checking', { exact: true })).toBeVisible()
	expect(operations).toEqual(['claim', 'discover'])
	await page.reload()
	await expect(discover).toBeEnabled()
	expect(operations).toEqual(['claim', 'discover'])
	await discover.click()
	await expect(row.getByText('Linked to Replacement checking', { exact: true })).toBeVisible()
	expect(operations).toEqual(['claim', 'discover', 'discover'])
	await page.goto('/accounts')
	const table = page.getByRole('table', { name: 'Accounts', exact: true })
	await expect(table.getByRole('row')).toHaveCount(3)
	await expect(table.getByRole('cell', { name: 'Existing checking', exact: true })).toBeVisible()
	await expect(table.getByRole('cell', { name: 'Replacement checking', exact: true })).toBeVisible()
	const checkingRow = table.getByRole('row').filter({ hasText: 'Replacement checking' })
	await expect(checkingRow.getByRole('cell').nth(3)).toHaveText('$0.00')
})

test('cancels a pending sync, ignores its late response, and imports only on a new explicit sync', async ({
	page
}) => {
	await installPasskey(page)
	const operations: string[] = []
	const pending = Promise.withResolvers<void>()
	const release = Promise.withResolvers<void>()
	const completed = Promise.withResolvers<void>()
	let syncs = 0
	await page.route('**/api/simplefin', async (route) => {
		const body: unknown = route.request().postDataJSON()
		if (
			!body ||
			typeof body !== 'object' ||
			!('operation' in body) ||
			typeof body.operation !== 'string'
		)
			throw new Error('Invalid provider command')
		operations.push(body.operation)
		if (body.operation === 'claim') {
			await route.fulfill({
				contentType: 'text/plain',
				body: 'https://test:synthetic@bridge.simplefin.org/simplefin'
			})
			return
		}
		const sync = body.operation === 'sync'
		if (sync) syncs += 1
		const delayed = sync && syncs === 1
		if (delayed) {
			pending.resolve()
			await release.promise
		}
		await route.fulfill({
			json: {
				errors: [],
				accounts: [
					{
						id: 'cancelled-checking',
						name: 'Cancelled Checking',
						currency: 'USD',
						org: { domain: 'bank.example', 'sfin-url': 'https://bank.example' },
						transactions: sync
							? [
									{
										id: 'cancelled-expense',
										amount: '-12.34',
										posted: 1792000000,
										description: 'Cancelled provider expense'
									}
								]
							: []
					}
				]
			}
		})
		if (delayed) completed.resolve()
	})
	await page.goto('/settings/banks')
	await page
		.getByLabel('SimpleFIN Bridge setup token', { exact: true })
		.fill(btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token'))
	for (const name of [
		'Create Passkey',
		'Test encryption with my passkey',
		'Test unlocking with my passkey',
		'Connect and save securely'
	]) {
		await page.getByRole('button', { name, exact: true }).click()
	}
	const discover = page.getByRole('button', { name: 'Discover Accounts', exact: true })
	await discover.click()
	await page.getByRole('button', { name: 'Add Account “Cancelled Checking”', exact: true }).click()
	await expect(page.getByText('Linked to Cancelled Checking', { exact: true })).toBeVisible()
	const main = page.getByRole('main')
	const sync = main.getByRole('button', { name: 'Sync now (last 90 days)', exact: true })
	await sync.click()
	await pending.promise
	await main.getByRole('button', { name: 'Cancel', exact: true }).click()
	await expect(sync).toBeEnabled()
	release.resolve()
	await completed.promise
	expect(operations).toEqual(['claim', 'discover', 'sync'])
	await expect(main.getByText(/Imported:/)).toHaveCount(0)
	await sync.click()
	await expect(main.getByText(/Imported: 1; already present: 0; omitted: 0/)).toBeVisible()
	expect(operations).toEqual(['claim', 'discover', 'sync', 'sync'])
	await page.reload()
	await expect(discover).toBeEnabled()
	expect(operations).toEqual(['claim', 'discover', 'sync', 'sync'])
})
