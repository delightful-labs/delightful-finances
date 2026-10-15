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
