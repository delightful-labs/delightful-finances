import { expect, test, type Page } from '@playwright/test'

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
	const checking = { id: 'checking', name: 'Provider Checking', currency: 'USD', org }
	const savings = { id: 'savings', name: 'Provider Savings', currency: 'USD', org }
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
	await expect(page.getByRole('button', { name: 'Discover accounts', exact: true })).toHaveCount(0)
	await input.fill(btoa('https://bridge.simplefin.org/simplefin/claim/synthetic-token'))
	await page.getByRole('button', { name: 'Create passkey', exact: true }).click()
	await page.getByRole('button', { name: 'Test encryption with my passkey', exact: true }).click()
	await page.getByRole('button', { name: 'Test unlocking with my passkey', exact: true }).click()
	await expect(
		page.getByRole('button', { name: 'Connect and save securely', exact: true })
	).toBeVisible()
	expect(operations).toEqual([])
	await page.getByRole('button', { name: 'Connect and save securely', exact: true }).click()
	const discover = page.getByRole('button', { name: 'Discover accounts', exact: true })
	await expect(discover).toBeEnabled()
	expect(operations).toEqual(['claim'])
	await discover.click()
	const addChecking = page.getByRole('button', {
		name: 'Add account “Provider Checking”',
		exact: true
	})
	await expect(addChecking).toBeEnabled()
	await expect(page.getByRole('combobox')).toHaveCount(0)
	await addChecking.click()
	await expect(page.getByText('Linked to Provider Checking', { exact: true })).toBeVisible()
	await expect(addChecking).toHaveCount(0)
	// The first linked account must never become a destination for savings.
	await expect(page.getByRole('combobox')).toHaveCount(0)
	await page.getByRole('button', { name: 'Add account “Provider Savings”', exact: true }).click()
	await expect(page.getByText('Linked to Provider Savings', { exact: true })).toBeVisible()
	const sync = page
		.getByRole('main')
		.getByRole('button', { name: 'Sync now (last 90 days)', exact: true })
	await sync.click()
	await expect(page.getByText(/Imported: 2; already present: 0; omitted: 2/)).toBeVisible()
	await sync.click()
	await expect(page.getByText(/Imported: 0; already present: 2; omitted: 2/)).toBeVisible()
	expect(operations).toEqual(['claim', 'discover', 'sync', 'sync'])
	await page.reload()
	await expect(discover).toBeEnabled()
	expect(operations).toEqual(['claim', 'discover', 'sync', 'sync'])
	failSync = true
	await sync.click()
	await expect(
		page
			.getByRole('main')
			.getByRole('status')
			.filter({ hasText: 'SimpleFIN could not complete the request' })
	).toBeVisible()
	await expect(sync).toBeEnabled()
	expect(operations).toEqual(['claim', 'discover', 'sync', 'sync', 'sync'])
	await page.getByRole('button', { name: 'Disconnect bank sync', exact: true }).click()
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
	const create = page.getByRole('button', { name: 'Create passkey', exact: true })
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
	const create = page.getByRole('button', { name: 'Create passkey', exact: true })
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
