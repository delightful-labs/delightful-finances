import { expect, test, type Page } from '@playwright/test'
import { RecoveryPhrase } from 'jazz-tools/passphrase'

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

const invalidPhrases = [
	{ name: 'wrong word count', phrase: 'abandon' },
	{ name: 'unknown word', phrase: Array(24).fill('notaword').join(' ') },
	{ name: 'invalid checksum', phrase: Array(24).fill('abandon').join(' ') }
]

for (const { name, phrase } of invalidPhrases) {
	test(`rejects ${name} without replacing the current account or data`, async ({ page }) => {
		// Confirm each fixture is invalid using Jazz's own recovery validator.
		expect(() => RecoveryPhrase.toSecret(phrase)).toThrow()
		await createAccount(page, 'Retained checking')
		const workspaceId = await page.getByLabel('Workspace', { exact: true }).inputValue()
		await page.goto('/login')
		await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await page.getByRole('button', { name: 'Restore account', exact: true }).click()
		await expect(page.getByRole('alert')).toHaveText(
			'The account could not be restored. Check the recovery phrase and try again.'
		)
		await expect(page).toHaveURL('/login')
		await expect(page.getByRole('button', { name: 'Restore account', exact: true })).toBeEnabled()
		await expect(page.getByLabel('Recovery phrase', { exact: true })).toHaveValue(phrase)
		await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue(workspaceId)

		await page.goto('/accounts')
		await page.reload()
		await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue(workspaceId)
		await expect(page.getByLabel('Workspace', { exact: true }).locator('option')).toHaveCount(1)
		await expect(page.getByRole('cell', { name: 'Retained checking', exact: true })).toHaveCount(1)
	})
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
