import type {} from '../src/lib/actor-inspection.js'
import { expect, test } from '@playwright/test'
import { prepareSidebar } from './helpers/ui.js'

test('actor inspection is absent by default', async ({ page }) => {
	await page.goto('/account')
	await expect(page.getByLabel('Display name', { exact: true })).toBeEnabled()
	expect(await page.evaluate(() => typeof window.__delightfulActorTrace)).toBe('undefined')
})

test('opt-in inspection covers independent actor roots, redacts private data and clears/disables', async ({
	page
}) => {
	await page.addInitScript(() => sessionStorage.setItem('delightful:actor-inspection', '1'))
	await page.goto('/account')
	await expect(page.getByLabel('Display name', { exact: true })).toBeEnabled()
	await prepareSidebar(page)
	await expect
		.poll(() =>
			page.evaluate(() => {
				const entries = window.__delightfulActorTrace?.read() ?? []
				return ['application-readiness', 'workspace-readiness', 'scoped-form'].every((label) =>
					entries.some((entry) => entry.label === label)
				)
			})
		)
		.toBe(true)
	const marker = 'inspection-private-profile-name'
	await page.getByLabel('Display name', { exact: true }).fill(marker)
	await page.getByRole('button', { name: 'Save', exact: true }).click()
	await expect(
		page.getByRole('main').getByRole('status').filter({ hasText: 'Profile Display name saved.' })
	).toHaveCount(1)
	expect(
		await page.evaluate((marker) => {
			const entries = window.__delightfulActorTrace?.read() ?? []
			return (
				entries.length <= 500 &&
				!JSON.stringify(entries).includes(marker) &&
				entries.some((entry) => entry.kind === 'ownership') &&
				new Set(entries.map((entry) => entry.system)).size > 1
			)
		}, marker)
	).toBe(true)
	await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
	const phrase = await page.getByLabel('Your recovery phrase', { exact: true }).inputValue()
	expect(
		await page.evaluate(
			(phrase) => !JSON.stringify(window.__delightfulActorTrace?.read()).includes(phrase),
			phrase
		)
	).toBe(true)
	await page.getByRole('button', { name: 'Close', exact: true }).click()
	await page.getByRole('link', { name: 'Login', exact: true }).click()
	await expect(page.getByLabel('Recovery phrase', { exact: true })).toBeVisible()
	await page.evaluate(() => window.__delightfulActorTrace?.clear())
	expect(await page.evaluate(() => window.__delightfulActorTrace?.read())).toEqual([])
	await page
		.getByLabel('Recovery phrase', { exact: true })
		.fill('inspection-private-invalid-phrase')
	await page.getByRole('button', { name: 'Login', exact: true }).click()
	await expect(page.getByRole('main').getByRole('alert').filter({ hasText: /\S/ })).toHaveText(
		'The account could not be restored. Check the recovery phrase and try again.'
	)
	expect(
		await page.evaluate(() => {
			const entries = window.__delightfulActorTrace?.read() ?? []
			const allowed = [
				'sequence',
				'system',
				'actor',
				'kind',
				'label',
				'source',
				'parent',
				'cause',
				'event',
				'status'
			]
			return (
				entries.some((entry) => entry.event === 'RECOVER') &&
				!JSON.stringify(entries).includes('inspection-private-invalid-phrase') &&
				entries.every((entry) => Object.keys(entry).every((key) => allowed.includes(key)))
			)
		})
	).toBe(true)
	await page.evaluate(() => window.__delightfulActorTrace?.disable())
	await page.getByRole('button', { name: 'Login', exact: true }).click()
	expect(await page.evaluate(() => window.__delightfulActorTrace?.read())).toEqual([])
})

test('unavailable diagnostic flag storage leaves the application usable and inspection disabled', async ({
	page
}) => {
	await page.addInitScript(() => {
		const getItem = Storage.prototype.getItem
		Storage.prototype.getItem = function (key) {
			if (key === 'delightful:actor-inspection')
				throw new DOMException('Storage unavailable', 'SecurityError')
			return getItem.call(this, key)
		}
	})
	await page.goto('/account')
	await expect(page.getByLabel('Display name', { exact: true })).toBeEnabled()
	expect(await page.evaluate(() => typeof window.__delightfulActorTrace)).toBe('undefined')
})
