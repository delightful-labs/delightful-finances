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

test('passkey demo requires explicit steps, completes a real crypto round trip, and makes no provider requests', async ({
	page
}) => {
	const providerRequests: string[] = []
	await page.route(/\/api\/simplefin|https:\/\/[^/]*simplefin\.org\//, async (route) => {
		providerRequests.push(route.request().url())
		await route.abort()
	})
	await installPasskey(page)
	await page.goto('/settings/passkey-demo')
	const create = page.getByRole('button', { name: 'Create passkey', exact: true })
	await expect(create).toBeDisabled()
	const input = page.locator('#passkey-demo-text')
	await expect(input).toHaveAttribute('type', 'text')
	await input.fill('dummy text, not a provider token')
	await create.click()
	await expect(input).toBeHidden()
	const encrypt = page.getByRole('button', { name: 'Test encryption with my passkey', exact: true })
	await expect(encrypt).toBeVisible()
	await expect(page.locator('html')).not.toHaveAttribute('data-assertions')
	await encrypt.click()
	const verify = page.getByRole('button', { name: 'Test unlocking with my passkey', exact: true })
	await expect(verify).toBeVisible()
	await expect(page.locator('html')).toHaveAttribute('data-assertions', '1')
	await verify.click()
	await expect(
		page.getByRole('heading', { name: 'Passkey test passed', exact: true })
	).toBeVisible()
	await expect(page.locator('html')).toHaveAttribute('data-assertions', '2')
	await page.getByRole('button', { name: 'Start another demo', exact: true }).click()
	await expect(input).toHaveValue('')
	await page.reload()
	await expect(input).toBeVisible()
	expect(providerRequests).toEqual([])
})

test('cancelling the demo clears the draft and prevents the next assertion', async ({ page }) => {
	await page.addInitScript(() => {
		class DemoCredential {
			rawId = new Uint8Array([1]).buffer
			getClientExtensionResults() {
				return { prf: { enabled: true } }
			}
		}
		Object.defineProperty(window, 'PublicKeyCredential', {
			value: DemoCredential,
			configurable: true
		})
		Object.defineProperty(navigator, 'credentials', {
			value: {
				create: async () => new DemoCredential(),
				get: async () => {
					throw new Error('Unexpected assertion')
				}
			},
			configurable: true
		})
	})
	await page.goto('/settings/passkey-demo')
	await page.locator('#passkey-demo-text').fill('discard me')
	await page.getByRole('button', { name: 'Create passkey', exact: true }).click()
	await expect(
		page.getByRole('button', { name: 'Test encryption with my passkey', exact: true })
	).toBeVisible()
	await page.getByRole('button', { name: 'Cancel', exact: true }).click()
	await expect(page.locator('#passkey-demo-text')).toHaveValue('')
	await expect(page.getByRole('button', { name: 'Create passkey', exact: true })).toBeDisabled()
})

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
	const sync = page.getByRole('button', { name: 'Sync now (last 90 days)', exact: true })
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
	await expect(page.getByRole('status')).toContainText('SimpleFIN could not complete the request')
	await expect(sync).toBeEnabled()
	expect(operations).toEqual(['claim', 'discover', 'sync', 'sync', 'sync'])
	await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
	await expect(discover).toHaveCount(0)
	await expect(sync).toHaveCount(0)
})
