import { expect, test, type Page } from '@playwright/test'

async function createAccount(page: Page, name: string) {
	await page.goto('/accounts/new')
	await page.getByLabel('Account name').fill(name)
	await page.getByLabel('Account type').selectOption('bank')
	await page.getByRole('button', { name: 'Add an account' }).click()
	await expect(page.getByRole('status')).toContainText(name)
}

async function restoreAccount(page: Page, phrase: string) {
	await page.goto('/login')
	await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
	await page.getByRole('button', { name: 'Restore account', exact: true }).click()
	await expect(page).toHaveURL('/')
}

test('restores existing workspace data without duplicates or previous identity accounts', async ({
	page,
	browser
}) => {
	await createAccount(page, 'Original checking')
	const workspaceId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	await page.goto('/account')
	await page.getByRole('button', { name: 'Show recovery phrase' }).click()
	const phrase = await page.getByLabel('Your recovery phrase').inputValue()
	await page.getByLabel('I saved this phrase somewhere safe.').check()
	await page.getByRole('button', { name: 'I saved the phrase' }).click()

	const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
	try {
		const otherPage = await otherContext.newPage()
		await createAccount(otherPage, 'Previous identity checking')
		await restoreAccount(otherPage, phrase)
		await expect(otherPage.getByLabel('Workspace', { exact: true })).toHaveValue(workspaceId)
		await expect(otherPage.getByLabel('Workspace', { exact: true }).locator('option')).toHaveCount(
			1
		)
		await otherPage.goto('/accounts')
		await expect(
			otherPage.getByRole('cell', { name: 'Original checking', exact: true })
		).toBeVisible()
		await expect(otherPage.getByText('Previous identity checking', { exact: true })).toHaveCount(0)

		await restoreAccount(otherPage, phrase)
		await otherPage.reload()
		await expect(otherPage.getByLabel('Workspace', { exact: true })).toHaveValue(workspaceId)
		await expect(otherPage.getByLabel('Workspace', { exact: true }).locator('option')).toHaveCount(
			1
		)
		await otherPage.goto('/accounts')
		await expect(
			otherPage.getByRole('cell', { name: 'Original checking', exact: true })
		).toHaveCount(1)
		await expect(otherPage.getByText('Previous identity checking', { exact: true })).toHaveCount(0)
		await otherPage.goto('/expenses/new')
		await expect(otherPage.getByLabel('Category', { exact: true }).locator('option')).toHaveCount(6)
		await otherPage.goto('/incomes/new')
		await expect(otherPage.getByLabel('Category', { exact: true }).locator('option')).toHaveCount(4)
	} finally {
		await otherContext.close()
	}
})
