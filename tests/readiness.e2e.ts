import { expect, test } from '@playwright/test'

test('startup storage failure is recoverable by an explicit retry', async ({ page }) => {
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.addInitScript(() => {
		const getItem = Storage.prototype.getItem
		let failed = false
		Storage.prototype.getItem = function (key) {
			if (!failed && key.startsWith('jazz-account-selection-v1:')) {
				failed = true
				throw new DOMException('Synthetic account storage failure', 'SecurityError')
			}
			return getItem.call(this, key)
		}
	})
	await page.goto('/settings/banks')
	await expect(
		page.getByText('Your finances could not be opened. Try again.', { exact: true })
	).toBeVisible()
	await page.getByRole('button', { name: 'Try again', exact: true }).click()
	await expect(page.getByLabel('SimpleFIN Bridge setup token', { exact: true })).toBeVisible()
	await expect(
		page.getByText('Your finances could not be opened. Try again.', { exact: true })
	).toBeHidden()
	expect(errors).toEqual([])
})
