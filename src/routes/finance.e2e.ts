import { expect, test } from '@playwright/test'

test('creates a workspace account and records an expense', async ({ page }) => {
	await page.goto('/accounts/new')
	await expect(page.getByRole('heading', { name: 'Add an account' })).toBeVisible()
	await page.getByLabel('Account name').fill('Everyday checking')
	await page.getByLabel('Account type').selectOption('bank')
	await page.getByRole('button', { name: 'Add an account' }).click()
	await expect(page.getByRole('status')).toContainText('Everyday checking')

	await page.goto('/expenses/new')
	await page.getByLabel('Account').selectOption({ label: 'Everyday checking' })
	await page.getByLabel('Category').selectOption({ label: 'Groceries' })
	await page.getByLabel(/Amount/).fill('12.34')
	await page.getByLabel('Memo').fill('Weekly market')
	await page.getByRole('button', { name: 'Save transaction' }).click()
	await expect(page.getByRole('status')).toHaveText('Transaction saved.')

	await page.goto('/expenses')
	await expect(page.getByText('Weekly market')).toBeVisible()
	await expect(page.getByText('$12.34')).toBeVisible()
})
