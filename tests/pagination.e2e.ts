import { expect, test, type Page } from '@playwright/test'
import { openSidebarSection } from './helpers/ui.js'

async function seed(page: Page, count = 0) {
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
	).toBeVisible()
	await page.evaluate(async (count) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client || !snapshot.account) throw new Error('Session not ready')
		const db = snapshot.client.db
		const organization = await db.one(
			app.organizations.where({ ownerId: snapshot.account.id, kind: 'personal' }),
			{ tier: 'local' }
		)
		if (!organization) throw new Error('Workspace not ready')
		const categories = await db.all(
			app.categories.where({ organizationId: organization.id, kind: 'expense' }),
			{ tier: 'local' }
		)
		const category = categories[0]
		if (!category) throw new Error('Category not ready')
		await db.transaction((tx) => {
			const account = tx.insert(app.accounts, {
				organizationId: organization.id,
				name: 'Pagination account',
				kind: 'bank',
				currency: 'USD'
			})
			for (let index = 0; index < count; index += 1) {
				tx.insert(app.transactions, {
					organizationId: organization.id,
					accountId: account.id,
					categoryId: category.id,
					amountMinor: 100,
					currency: 'USD',
					kind: 'expense',
					bookedOn: '2026-10-19',
					memo: `Pagination fixture ${index + 1}`,
					source: 'manual'
				})
			}
		})
	}, count)
	await expect(
		page.getByRole('main').getByRole('cell', { name: 'Pagination account', exact: true })
	).toBeVisible()
}

async function openMenu(page: Page) {
	const trigger = page.getByRole('button', { name: 'Developer menu', exact: true })
	await trigger.focus()
	await trigger.press('Enter')
	const dialog = page.getByRole('dialog', { name: 'Developer menu', exact: true })
	await expect(dialog).toBeVisible()
	return dialog
}

test('global keyboard developer menu saves both sample kinds and retains progress across pages', async ({
	page
}) => {
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await seed(page)
	await page.reload()
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Accounts', exact: true })
	).toBeVisible()
	await page.keyboard.press('Tab')
	const trigger = page.getByRole('button', { name: 'Developer menu', exact: true })
	await expect(trigger).toBeFocused()
	const box = await trigger.boundingBox()
	expect(box?.width).toBeGreaterThan(1)
	await page.keyboard.press('Enter')
	const dialog = page.getByRole('dialog', { name: 'Developer menu', exact: true })
	await expect(dialog).toBeVisible()
	const income = dialog.getByRole('button', {
		name: 'Add 25 sample income transactions',
		exact: true
	})
	const expense = dialog.getByRole('button', {
		name: 'Add 25 sample expense transactions',
		exact: true
	})
	await expect(income).toBeVisible()
	await expense.click()
	await expect(dialog.getByRole('status')).toHaveText('Saved 25 of 25 sample transactions.')
	await page.keyboard.press('Escape')
	await expect(dialog).toBeHidden()
	await expect(trigger).toBeFocused()
	await page.locator('aside').getByRole('link', { name: 'Expenses', exact: true }).click()
	await expect(
		page.getByRole('main').getByRole('link', { name: /Sample transaction/ })
	).toHaveCount(25)
	await openMenu(page)
	await expect(dialog.getByRole('status')).toHaveText('Saved 25 of 25 sample transactions.')
	await income.click()
	await expect(dialog.getByRole('status')).toHaveCount(2)
	await expect(dialog.getByRole('status')).toHaveText([
		'Saved 25 of 25 sample transactions.',
		'Saved 25 of 25 sample transactions.'
	])
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await page.locator('aside').getByRole('link', { name: 'Income', exact: true }).click()
	await expect(
		page.getByRole('main').getByRole('link', { name: /Sample transaction/ })
	).toHaveCount(25)
	await page.locator('aside').getByRole('link', { name: 'Login', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Restore an account', exact: true })).toBeVisible()
	await openMenu(page)
	await expect(income).toBeVisible()
	await expect(expense).toBeVisible()
	expect(errors).toEqual([])
})

test('URL pages preserve totals, five slots, history, reload and filter reset', async ({
	page
}) => {
	await seed(page, 201)
	await page.goto('/expenses?other=keep')
	const navigation = page.getByRole('navigation', { name: 'Transaction pages', exact: true })
	const entries = page.getByRole('main').getByRole('link', { name: /Pagination fixture/ })
	await expect(entries).toHaveCount(25)
	await expect(page.getByLabel('Daily total: $201.00', { exact: true })).toBeVisible()
	await expect(navigation.getByRole('listitem')).toHaveCount(7)
	await expect(navigation.getByLabel('Previous page', { exact: true })).toHaveAttribute(
		'aria-disabled',
		'true'
	)
	await navigation.getByRole('link', { name: 'Page 3', exact: true }).click()
	await expect(page).toHaveURL('/expenses?other=keep&page=3')
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('3')
	await navigation.getByRole('link', { name: 'Next page', exact: true }).click()
	await expect(navigation.getByRole('listitem')).toHaveCount(7)
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('4')
	await page.goBack()
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('3')
	await page.goForward()
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('4')
	await page.reload()
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('4')
	await navigation.getByRole('link', { name: 'Page 9', exact: true }).click()
	await expect(entries).toHaveCount(1)
	await expect(navigation.getByRole('listitem')).toHaveCount(7)
	await expect(navigation.getByLabel('Next page', { exact: true })).toHaveAttribute(
		'aria-disabled',
		'true'
	)
	await expect(page.getByLabel('Daily total: $201.00', { exact: true })).toBeVisible()
	await navigation.getByRole('link', { name: 'Page 1', exact: true }).click()
	await expect(page).toHaveURL('/expenses?other=keep')
	await page.goto('/expenses?page=999')
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('9')
	await page.goto('/expenses?page=invalid')
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('1')
	await page.goto('/expenses?page=4')
	await expect(navigation.locator('[aria-current="page"]')).toHaveText('4')
	const accounts = await openSidebarSection(page, 'Accounts')
	await accounts.getByRole('checkbox', { name: 'Show Pagination account', exact: true }).uncheck()
	await expect(page).toHaveURL('/expenses')
	await expect(navigation).toHaveCount(0)
})

test('five-page mobile navigation never truncates or changes its item count', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 900 })
	await seed(page, 125)
	await page.goto('/expenses')
	const navigation = page.getByRole('navigation', { name: 'Transaction pages', exact: true })
	for (const number of [1, 3, 4, 5]) {
		await navigation.getByRole('link', { name: `Page ${number}`, exact: true }).click()
		await expect(navigation.locator('[aria-current="page"]')).toHaveText(String(number))
		await expect(navigation.getByRole('listitem')).toHaveCount(7)
		await expect(navigation.getByRole('link', { name: /^Page \d+$/ })).toHaveCount(5)
	}
	const box = await navigation.boundingBox()
	expect(box).not.toBeNull()
	if (box) expect(box.x + box.width).toBeLessThanOrEqual(390)
})
