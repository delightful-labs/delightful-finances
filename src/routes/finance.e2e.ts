import { expect, test } from '@playwright/test'

test('creates a workspace account and records an expense', async ({ page }) => {
	await page.goto('/accounts')
	const main = page.getByRole('main')
	await main.getByRole('button', { name: 'Add Account', exact: true }).click()
	const dialog = page.getByRole('dialog', { name: 'Add Account', exact: true })
	await dialog.getByLabel('Account name').fill('Everyday checking')
	await dialog.getByLabel('Account type').selectOption('bank')
	await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
	await expect(dialog.getByRole('status')).toContainText('Everyday checking')
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

	await page.goto('/expenses/new')
	await main.getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday checking' })
	await main.getByLabel('Amount', { exact: true }).fill('12.34')
	await main.getByLabel('Memo').fill('Weekly market')
	await main.getByRole('button', { name: 'Save transaction', exact: true }).click()
	await expect(main.getByRole('status')).toHaveText('Transaction saved.')

	await page.goto('/expenses')
	await expect(main.getByText('Weekly market', { exact: true })).toBeVisible()
	await expect(
		main.getByRole('link').filter({ hasText: 'Weekly market' }).getByText('$12.34', { exact: true })
	).toBeVisible()
})
