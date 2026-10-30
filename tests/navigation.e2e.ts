import { expect, test } from '@playwright/test'

test('mobile drawer preserves content width, prevents overflow and restores focus after dismissal', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 900 })
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto('/accounts')
	const toggle = page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
	const main = page.locator('main .content')
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
	).toBeVisible()
	await expect(toggle).toHaveAttribute('aria-expanded', 'false')
	await toggle.click()
	await expect(main).toHaveAttribute('inert', '')
	await expect.poll(async () => (await main.boundingBox())?.width).toBe(390)
	await expect.poll(async () => (await main.boundingBox())?.x).toBeCloseTo(334, 0)
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
	const dismiss = page.getByRole('button', { name: 'Close Main navigation', exact: true })
	await expect(dismiss).toBeVisible()
	await page.setViewportSize({ width: 1280, height: 900 })
	await expect(main).not.toHaveAttribute('inert', '')
	await expect(toggle).toHaveAttribute('aria-expanded', 'true')
	await expect(dismiss).toBeHidden()
	await page.setViewportSize({ width: 390, height: 900 })
	await expect(main).toHaveAttribute('inert', '')
	await dismiss.click()
	await expect(toggle).toHaveAttribute('aria-expanded', 'false')
	await expect(toggle).toBeFocused()
	await expect(main).not.toHaveAttribute('inert', '')
	await expect.poll(async () => (await main.boundingBox())?.x).toBe(0)
})

test('sidebar disclosures and shared links retain exact current-page and workspace scope', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 900 })
	await page.goto('/accounts')
	const sidebar = page.locator('aside.site-drawer')
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
	).toBeVisible()
	const accounts = sidebar
		.locator('details')
		.filter({ has: page.locator('summary', { hasText: 'Accounts' }) })
	const settings = sidebar
		.locator('details')
		.filter({ has: page.locator('summary', { hasText: 'Settings' }) })
	await expect(accounts).not.toHaveAttribute('open', '')
	await expect(settings).not.toHaveAttribute('open', '')
	await accounts.locator('summary').click()
	await expect(sidebar.locator('a[aria-current="page"]')).toHaveCount(1)
	await expect(
		accounts.getByRole('link', { name: 'Manage Accounts', exact: true })
	).toHaveAttribute('aria-current', 'page')
	await settings.locator('summary').click()
	const selector = settings.getByLabel('Current Workspace', { exact: true })
	await expect(selector).not.toHaveValue('')
	const workspaceId = await selector.inputValue()
	await settings.getByRole('link', { name: 'Workspaces', exact: true }).click()
	await expect(page).toHaveURL(`/settings/workspace?workspace=${workspaceId}`)
	await expect(sidebar.locator('a[aria-current="page"]')).toHaveCount(1)
	await expect(settings.getByRole('link', { name: 'Workspaces', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	)
	await expect(
		accounts.getByRole('link', { name: 'Manage Accounts', exact: true })
	).not.toHaveAttribute('aria-current', 'page')
	await expect(settings.getByRole('link', { name: 'Account', exact: true })).toHaveAttribute(
		'href',
		`/account?workspace=${workspaceId}`
	)
	await expect(sidebar.getByRole('link', { name: 'Login', exact: true })).toHaveAttribute(
		'href',
		`/login?workspace=${workspaceId}`
	)
})

for (const width of [390, 768, 769, 1280]) {
	test(`drawer initializes and navigates at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 })
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await page.goto('/accounts')
		const toggle = page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
		const drawer = page.locator('aside.site-drawer')
		const mobile = width <= 768
		await expect(toggle).toHaveAttribute('aria-expanded', String(!mobile))
		await expect(drawer).toHaveAttribute('aria-hidden', String(mobile))
		if (mobile) await toggle.click()
		await expect(toggle).toHaveAttribute('aria-expanded', 'true')
		await drawer.getByRole('link', { name: 'Expenses', exact: true }).click()
		await expect(page).toHaveURL(/\/expenses\?workspace=[a-f0-9-]+$/)
		await expect(toggle).toHaveAttribute('aria-expanded', String(!mobile))
		await expect(drawer).toHaveAttribute('aria-hidden', String(mobile))
		if (mobile) await toggle.click()
		await drawer.locator('summary', { hasText: 'Accounts' }).click()
		const addAccount = drawer.getByRole('button', { name: 'Add Account', exact: true })
		await addAccount.click()
		const dialog = page.getByRole('dialog', { name: 'Add Account', exact: true })
		await expect(dialog).toBeVisible()
		await expect(page).toHaveURL(/\/expenses\?workspace=[a-f0-9-]+$/)
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
		await expect(dialog).not.toBeVisible()
		await expect(addAccount).toBeFocused()
		await expect(toggle).toHaveAttribute('aria-expanded', 'true')
		await toggle.click()
		await expect(toggle).toHaveAttribute('aria-expanded', 'false')
		await page.reload()
		await expect(
			page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
		).toHaveAttribute('aria-expanded', String(!mobile))
	})
}

test('resizing preserves disclosure state and navigation uses the current viewport', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 900 })
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto('/accounts')
	const toggle = page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
	const drawer = page.locator('aside.site-drawer')
	await expect(toggle).toHaveAttribute('aria-expanded', 'true')
	await page.setViewportSize({ width: 390, height: 900 })
	await expect(toggle).toHaveAttribute('aria-expanded', 'true')
	await drawer.getByRole('link', { name: 'Expenses', exact: true }).click()
	await expect(page).toHaveURL(/\/expenses\?workspace=[a-f0-9-]+$/)
	await expect(toggle).toHaveAttribute('aria-expanded', 'false')
	await page.setViewportSize({ width: 1280, height: 900 })
	await expect(toggle).toHaveAttribute('aria-expanded', 'false')
	await toggle.click()
	await drawer.locator('summary', { hasText: 'Accounts' }).click()
	await drawer.getByRole('link', { name: 'Manage Accounts', exact: true }).click()
	await expect(page).toHaveURL(/\/accounts\?workspace=[a-f0-9-]+$/)
	await expect(toggle).toHaveAttribute('aria-expanded', 'true')
})
