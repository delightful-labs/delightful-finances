import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await expect(
		page.getByRole('complementary').getByRole('navigation', { name: 'Main navigation' })
	).toBeVisible()
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready
	})
	await page.reload()
	await expect
		.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
		.toBe(true)
})

test('loads an unvisited page and reloads its shell offline', async ({ page, context }) => {
	await page.goto('/accounts/new')
	await page.getByLabel('Account name').fill('Offline checking')
	await page.getByLabel('Account type').selectOption('bank')
	await page.getByRole('button', { name: 'Add an account' }).click()
	await expect(page.getByRole('main').getByRole('status')).toContainText('Offline checking')
	await context.setOffline(true)
	const response = await page.goto('/expenses/new')
	expect(response?.fromServiceWorker()).toBe(true)
	await expect(page.getByRole('heading', { name: 'Add expense' })).toBeVisible()
	await expect(page.getByLabel('Account', { exact: true })).toContainText('Offline checking')
	const reload = await page.reload()
	expect(reload?.fromServiceWorker()).toBe(true)
	await expect(page.getByRole('heading', { name: 'Add expense' })).toBeVisible()
	await expect(page.getByLabel('Account', { exact: true })).toContainText('Offline checking')
})

test('caches only same-origin public shells and build assets', async ({ page }) => {
	const paths = await page.evaluate(async () => {
		const names = await caches.keys()
		const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()))
		return requests.flat().map((request) => request.url)
	})
	expect(paths.length).toBeGreaterThan(0)
	for (const path of paths) {
		const url = new URL(path)
		expect(url.origin).toBe('http://127.0.0.1:4173')
		expect(url.pathname).toMatch(
			/^\/(?:$|_app\/immutable\/|app-icon\.svg$|robots\.txt$|manifest\.webmanifest$|accounts(?:\/new)?$|account$|expenses(?:\/new)?$|incomes(?:\/new)?$|login$)/
		)
	}
})

test('a worker update waits without replacing or reloading the open page', async ({ page }) => {
	await page.goto('/accounts/new')
	await page.getByLabel('Account name').fill('Unsaved account')
	const workerPath = '.svelte-kit/output/client/service-worker.js'
	const original = await readFile(workerPath, 'utf8')
	let navigations = 0
	page.on('framenavigated', (frame) => {
		if (frame === page.mainFrame()) navigations += 1
	})
	try {
		// Change only generated output bytes to simulate a deployed worker update.
		await writeFile(workerPath, `${original}\n// Playwright update fixture\n`)
		await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.ready
			await registration.update()
		})
		await expect
			.poll(() =>
				page.evaluate(async () => {
					const registration = await navigator.serviceWorker.ready
					return registration.waiting?.state
				})
			)
			.toBe('installed')
		expect(navigations).toBe(0)
		await expect(page.getByLabel('Account name')).toHaveValue('Unsaved account')
		expect(
			await page.evaluate(async () => {
				const registration = await navigator.serviceWorker.ready
				return navigator.serviceWorker.controller === registration.active
			})
		).toBe(true)
	} finally {
		await writeFile(workerPath, original)
	}
})
