import { expect, test } from '@playwright/test'

const fixture = '/__form-presentation'

// Supply the test-only document through Playwright. Vite transforms the entry
// module and actual shared components; no application route is introduced.
test.beforeEach(async ({ page }) => {
	await page.route('**/__form-presentation*', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Form fixture</title></head><body><script type="module" src="/src/lib/testing/form-presentation/form-presentation-entry.ts"></script></body></html>'
		})
	)
})

test('scoped fields react to access; accepted reset rebuilds fields and busy reset preserves them', async ({
	page
}) => {
	await page.goto(fixture)
	const name = page.getByRole('textbox', { name: 'Name', exact: true })
	await expect(name).toBeEnabled()
	await name.fill('Draft')
	await name.evaluate((node) => node.setAttribute('data-original', 'true'))
	await page.getByRole('button', { name: 'Toggle access', exact: true }).click()
	await expect(name).toBeDisabled()
	await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
	await page.getByRole('button', { name: 'Toggle access', exact: true }).click()
	await expect(name).toBeEnabled()
	await page.getByRole('button', { name: 'Reset draft', exact: true }).click()
	await expect(name).toHaveValue('')
	await expect(name).not.toHaveAttribute('data-original')
	await expect(page.getByTestId('revision')).toHaveText('1')
	await name.fill('Pending')
	await name.evaluate((node) => node.setAttribute('data-original', 'busy'))
	await page.getByRole('button', { name: 'Save draft', exact: true }).click()
	await expect(page.getByTestId('activity')).toHaveText('operating')
	await expect(name).toBeDisabled()
	await expect(page.locator('form')).toHaveAttribute('aria-busy', 'true')
	await page.getByRole('button', { name: 'Request reset', exact: true }).click()
	await expect(name).toHaveValue('Pending')
	await expect(name).toHaveAttribute('data-original', 'busy')
	await expect(page.getByTestId('revision')).toHaveText('1')
	await page.getByRole('button', { name: 'Finish write', exact: true }).click()
	await expect(page.getByRole('status')).toHaveText('succeeded')
	await expect(page.locator('form')).toHaveAttribute('aria-busy', 'false')
	await page.getByRole('button', { name: 'Reset draft', exact: true }).click()
	await expect(name).toHaveValue('')
	await expect(name).toBeEnabled()
})

test('modal preserves drafts across Escape/backdrop; closes and reopens issued work without cancellation; renders void success', async ({
	page
}) => {
	await page.goto(`${fixture}?modal`)
	const trigger = page.getByRole('button', { name: 'Save draft', exact: true }).first()
	const dialog = page.getByRole('dialog', { name: 'Save draft', exact: true })
	await trigger.click()
	const name = dialog.getByRole('textbox', { name: 'Name', exact: true })
	await name.fill('Keep this draft')
	await page.keyboard.press('Escape')
	await expect(dialog).not.toBeVisible()
	await trigger.click()
	await expect(name).toHaveValue('Keep this draft')
	await page.mouse.click(2, 2)
	await expect(dialog).not.toBeVisible()
	await trigger.click()
	await expect(name).toHaveValue('Keep this draft')
	await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
	await expect(dialog.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(dialog).not.toBeVisible()
	await expect(page.getByTestId('activity')).toHaveText('operating')
	await trigger.click()
	await expect(name).toHaveValue('Keep this draft')
	await expect(name).toBeDisabled()
	await expect(page.getByTestId('starts')).toHaveText('1')
	await expect(page.getByTestId('cancellations')).toHaveText('0')
	// Settle via the fixture control while the native dialog makes the background inert.
	await page.getByRole('button', { name: 'Finish write', exact: true }).evaluate((node) => {
		if (!(node instanceof HTMLElement)) throw new Error('Expected button')
		node.click()
	})
	await expect(dialog.getByRole('status')).toHaveText('succeeded')
	await expect(dialog.getByRole('textbox')).toHaveCount(0)
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await trigger.click()
	await expect(name).toHaveValue('')
	await expect(name).toBeEnabled()
	await expect(page.getByTestId('starts')).toHaveText('1')
})

test('scope replacement closes the modal and resets its visible draft', async ({ page }) => {
	await page.goto(`${fixture}?modal`)
	const trigger = page.getByRole('button', { name: 'Save draft', exact: true }).first()
	const dialog = page.getByRole('dialog')
	await trigger.click()
	await dialog.getByRole('textbox').fill('Old workspace')
	await page.getByRole('button', { name: 'Replace scope', exact: true }).evaluate((node) => {
		if (!(node instanceof HTMLElement)) throw new Error('Expected button')
		node.click()
	})
	await expect(dialog).not.toBeVisible()
	await trigger.click()
	await expect(dialog.getByRole('textbox')).toHaveValue('')
	await expect(page.getByTestId('starts')).toHaveText('0')
})

test('existing account modal retains validation, draft dismissal, save feedback and fresh reopen through the legacy adapter', async ({
	page
}) => {
	await page.goto('/accounts')
	const trigger = page
		.getByRole('main')
		.getByRole('button', { name: 'Add Account', exact: true })
		.first()
	await expect(trigger).toBeEnabled()
	await trigger.click()
	const dialog = page.getByRole('dialog', { name: 'Add Account', exact: true })
	const name = dialog.getByLabel('Account name', { exact: true })
	await name.fill('   ')
	await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
	await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
	await expect(dialog.getByRole('alert')).toBeVisible()
	await name.fill('Presentation checking')
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
	await expect(dialog).not.toBeVisible()
	await trigger.click()
	await expect(name).toHaveValue('Presentation checking')
	await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
	await expect(dialog.getByRole('status')).toContainText('Presentation checking')
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(
		page.getByRole('main').getByRole('cell', { name: 'Presentation checking', exact: true })
	).toBeVisible()
	await trigger.click()
	await expect(name).toHaveValue('')
})

test('shared edit mode disables unchanged workspace saves, preserves stable labels and persists offline', async ({
	page,
	context
}) => {
	await page.goto('/settings/workspace')
	const name = page.getByLabel('Workspace name', { exact: true })
	const save = page.getByRole('main').getByRole('button', { name: 'Save', exact: true })
	await expect(name).toBeEditable()
	const original = await name.inputValue()
	await expect(save).toBeDisabled()
	await name.fill('A changed name')
	await expect(save).toBeEnabled()
	await name.fill(original)
	await expect(save).toBeDisabled()
	await name.fill(`  ${original}  `)
	await expect(save).toBeDisabled()
	await name.fill('   ')
	await expect(save).toBeEnabled()
	await save.click()
	await expect(page.getByRole('main').getByRole('alert')).toHaveText('Enter a workspace name.')
	await name.fill('Offline edit mode workspace')
	await expect(save).toBeEnabled()
	await context.setOffline(true)
	await save.click()
	await expect(page.getByRole('main').getByRole('status')).toHaveText(
		'Workspace name saved on this device.'
	)
	await expect(save).toHaveText('Save')
	await expect(save).toBeDisabled()
	await expect(name).toBeEditable()
	await context.setOffline(false)
	await page.reload()
	await expect(name).toHaveValue('Offline edit mode workspace')
	await expect(save).toBeDisabled()
	await name.fill('Another edit')
	await expect(save).toBeEnabled()
})
