import { expect, test, type Locator } from '@playwright/test'

async function bounds(locator: Locator) {
	const box = await locator.boundingBox()
	if (!box) throw new Error('Expected visible element geometry')
	return box
}

test('inline navigation keeps page height stable and scrolls inside its full-height panel', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 420 })
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto('/accounts/new')
	await expect(page.getByLabel('Account name', { exact: true })).toBeVisible()
	const sidebar = page.locator('aside.inline-drawer')
	await expect(sidebar).toBeVisible()
	const close = sidebar.getByRole('button', { name: 'Close navigation', exact: true })
	await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeHidden()
	const before = await bounds(page.locator('.page-content'))
	expect((await bounds(sidebar)).height).toBe(420)
	expect((await bounds(close)).width).toBe(44)
	const body = sidebar.locator('.drawer-body')
	expect(await body.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
	await sidebar.getByRole('link', { name: 'Add an account', exact: true }).focus()
	expect(await body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
	expect((await bounds(close)).y).toBeGreaterThanOrEqual(0)
	await close.click()
	const open = page.getByRole('button', { name: 'Open navigation', exact: true })
	await expect(open).toBeFocused()
	await expect(sidebar).toBeHidden()
	expect((await bounds(page.locator('.page-content'))).y).toBe(before.y)
	await open.click()
	await expect(sidebar).toBeVisible()
	expect((await bounds(page.locator('.page-content'))).y).toBe(before.y)
})

test('mobile navigation has one compact close control and restores focus after Escape and backdrop dismissal', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 650 })
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto('/accounts/new')
	await expect(page.getByLabel('Account name', { exact: true })).toBeVisible()
	const open = page.getByRole('button', { name: 'Open navigation', exact: true })
	await open.click()
	const dialog = page.getByRole('dialog', { name: 'Main navigation', exact: true })
	await expect(dialog).toBeVisible()
	expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(true)
	const close = page.getByRole('button', { name: 'Close navigation', exact: true })
	await expect(close).toHaveCount(1)
	expect((await bounds(close)).width).toBe(44)
	expect((await bounds(dialog)).height).toBe(650)
	await page.keyboard.press('Escape')
	await expect(dialog).toBeHidden()
	await expect(open).toBeFocused()
	await open.click()
	await expect(dialog).toBeVisible()
	await page.mouse.click(385, 300)
	await expect(dialog).toBeHidden()
	await expect(open).toBeFocused()
})

test('sidebar status follows browser connectivity without claiming completed sync', async ({
	page,
	context
}) => {
	await page.setViewportSize({ width: 1280, height: 1000 })
	await page.goto('/accounts/new')
	await expect(page.getByLabel('Account name', { exact: true })).toBeVisible()
	const sidebar = page.locator('aside.inline-drawer')
	const status = sidebar.getByRole('status')
	await expect(status).toHaveCount(1)
	await expect(status).toHaveText('Sync enabled')
	await expect(status.locator('[aria-hidden="true"]')).toHaveCount(1)
	const body = await bounds(sidebar.locator('.drawer-body'))
	const indicator = await bounds(status)
	expect(Math.abs(body.y + body.height - indicator.y - indicator.height)).toBeLessThan(2)
	const name = page.getByLabel('Account name', { exact: true })
	await name.fill('Unsaved draft')
	await name.focus()
	try {
		await context.setOffline(true)
		await expect(status).toHaveText('Offline — working locally')
		await expect(name).toBeFocused()
		await expect(name).toHaveValue('Unsaved draft')
	} finally {
		await context.setOffline(false)
	}
	await expect(status).toHaveText('Sync enabled')
	await sidebar.getByRole('link', { name: 'Expenses', exact: true }).click()
	await expect(page).toHaveURL('/expenses')
	await expect(status).toHaveText('Sync enabled')
})

test('sidebar status does not claim a successful sync when the database is disconnected', async ({
	page
}) => {
	await page.goto('/accounts/new')
	await expect(page.getByLabel('Account name', { exact: true })).toBeVisible()
	const status = page.locator('aside.inline-drawer').getByRole('status')
	await page.evaluate(async () => {
		const sessionPath = '/src/lib/jazz-session.ts'
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Test session is not ready.')
		await db.disconnect()
	})
	await expect(status).toHaveText('Sync enabled')
	await expect(status).not.toContainText(/synced|connected|saved/i)
})

test('mobile sidebar status stays inside the Drawer and is hidden when it closes', async ({
	page,
	context
}) => {
	await page.setViewportSize({ width: 390, height: 650 })
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto('/accounts/new')
	await expect(page.getByLabel('Account name', { exact: true })).toBeVisible()
	const open = page.getByRole('button', { name: 'Open navigation', exact: true })
	await open.click()
	const drawer = page.getByRole('dialog', { name: 'Main navigation', exact: true })
	const status = drawer.getByRole('status')
	await expect(status).toHaveText('Sync enabled')
	try {
		await context.setOffline(true)
		await expect(status).toHaveText('Offline — working locally')
		await status.scrollIntoViewIfNeeded()
		await expect(status).toBeInViewport()
		expect(await drawer.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
		await page.keyboard.press('Escape')
		await expect(drawer).toBeHidden()
		await expect(open).toBeFocused()
		await expect(page.getByRole('status')).toHaveCount(0)
	} finally {
		await context.setOffline(false)
	}
	await open.click()
	await expect(status).toHaveText('Sync enabled')
})
