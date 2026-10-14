import { expect, test, type Page } from '@playwright/test'
import { RecoveryPhrase } from 'jazz-tools/passphrase'

async function createAccount(page: Page, name: string) {
	await page.goto('/accounts/new')
	await expect(page.getByLabel('Workspace', { exact: true })).not.toHaveValue('')
	await expect(page.getByRole('button', { name: 'Add an account', exact: true })).toBeEnabled()
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
	browser,
	baseURL
}) => {
	await createAccount(page, 'Original checking')
	const workspaceId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	await page.goto('/account')
	await page.getByRole('button', { name: 'Show recovery phrase' }).click()
	const phrase = await page.getByLabel('Your recovery phrase').inputValue()
	await page.getByLabel('I saved this phrase somewhere safe.').check()
	await page.getByRole('button', { name: 'I saved the phrase' }).click()

	const otherContext = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:5173' })
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

test('recovery modal clears its content and confirmation on every dismissal', async ({ page }) => {
	await createAccount(page, 'Recovery modal checking')
	await page.goto('/account')
	const show = page.getByRole('button', { name: 'Show recovery phrase' })
	const dialog = page.getByRole('dialog', { name: 'Account recovery' })
	const phrase = page.getByLabel('Your recovery phrase', { exact: true })
	const confirmation = page.getByLabel('I saved this phrase somewhere safe.')
	const complete = page.getByRole('button', { name: 'I saved the phrase', exact: true })

	for (const dismissal of ['close', 'escape', 'backdrop', 'complete']) {
		await show.click()
		await expect(dialog).toBeVisible()
		// Never include recovery secrets in assertion output or test artifacts.
		expect(await phrase.evaluate((element: HTMLTextAreaElement) => element.value.length > 0)).toBe(
			true
		)
		await expect(confirmation).not.toBeChecked()
		await expect(complete).toBeDisabled()
		await phrase.click()
		await expect(dialog).toBeVisible()
		if (dismissal === 'complete') {
			await confirmation.check()
			await complete.click()
		} else if (dismissal === 'escape') {
			await confirmation.check()
			await page.keyboard.press('Escape')
		} else if (dismissal === 'backdrop') {
			await page.mouse.click(1, 1)
		} else {
			await page.getByRole('button', { name: 'Close', exact: true }).click()
		}
		await expect(dialog).not.toBeVisible()
		await expect(phrase).toHaveCount(0)
		await expect(show).toBeFocused()
	}
})

async function saveDisplayName(page: Page, name: string) {
	await page.goto('/account')
	await expect(page.getByLabel('Display name', { exact: true })).toBeEnabled()
	await page.getByLabel('Display name', { exact: true }).fill(name)
	await page.getByRole('button', { name: 'Save', exact: true }).click()
	await expect(page.getByRole('status')).toHaveText('Display name saved on this device.')
}

test('profile name trims, survives reload, and can be cleared', async ({ page }) => {
	await saveDisplayName(page, '  Profile owner  ')
	await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Profile owner')
	await page.reload()
	await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Profile owner')
	await page.getByLabel('Display name', { exact: true }).fill('  ')
	await page.getByRole('button', { name: 'Save', exact: true }).click()
	await expect(page.getByRole('status')).toHaveText('Display name saved on this device.')
	await page.reload()
	await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('')
})

test('profile name follows the recovered identity across devices', async ({
	page,
	browser,
	baseURL
}) => {
	await saveDisplayName(page, 'Recovered owner')
	// Confirm synchronization without including recovery secrets in output.
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const schemaPath = '/src/lib/schema.ts'
				const sessionPath = '/src/lib/jazz-session.ts'
				const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
				const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
					sessionPath
				)
				const snapshot = getCurrentJazzSession()?.getSnapshot()
				if (!snapshot?.client || !snapshot.account) throw new Error('Session not ready')
				return (
					await snapshot.client.db.one(app.profiles.where({ userId: snapshot.account.id }), {
						tier: 'remote'
					})
				)?.displayName
			})
		)
		.toBe('Recovered owner')
	await page.getByRole('button', { name: 'Show recovery phrase' }).click()
	const phrase = await page.getByLabel('Your recovery phrase').inputValue()
	await page.getByRole('button', { name: 'Close', exact: true }).click()
	const context = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:5173' })
	try {
		const other = await context.newPage()
		await saveDisplayName(other, 'Previous identity')
		await restoreAccount(other, phrase)
		await other.goto('/account')
		await expect(other.getByLabel('Display name', { exact: true })).toHaveValue('Recovered owner')
		await other.reload()
		await expect(other.getByLabel('Display name', { exact: true })).toHaveValue('Recovered owner')
		await page.reload()
		await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Recovered owner')
	} finally {
		await context.close()
	}
})
