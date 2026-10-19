import { openCreationModal, creationDialog } from './helpers/ui.js'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await expect(page.getByRole('button', { name: 'Toggle navigation', exact: true })).toBeVisible()
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready
	})
	await page.reload()
	await expect
		.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
		.toBe(true)
})

test('loads an unvisited page and reloads its shell offline', async ({ page, context }) => {
	await page.goto('/accounts')
	await openCreationModal(page, 'Add Account')
	await creationDialog(page, 'Add Account').getByLabel('Account name').fill('Offline checking')
	await creationDialog(page, 'Add Account').getByLabel('Account type').selectOption('bank')
	await creationDialog(page, 'Add Account')
		.getByRole('button', { name: 'Add Account', exact: true })
		.click()
	await expect(creationDialog(page, 'Add Account').getByRole('status')).toContainText(
		'Offline checking'
	)
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
			/^\/(?:$|_app\/immutable\/|app-icon\.svg$|favicon\.svg$|settings\/(?:categories|tags|workspace|banks)$|robots\.txt$|manifest\.webmanifest$|accounts$|account$|expenses(?:\/new)?$|incomes(?:\/new)?$|login$)/
		)
	}
})

test('a worker update waits without replacing or reloading the open page', async ({ page }) => {
	await page.goto('/accounts')
	await openCreationModal(page, 'Add Account')
	await creationDialog(page, 'Add Account').getByLabel('Account name').fill('Unsaved account')
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
		await expect(creationDialog(page, 'Add Account').getByLabel('Account name')).toHaveValue(
			'Unsaved account'
		)
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

test('serves a saved transaction detail directly and after reload in production', async ({
	page
}) => {
	await page.goto('/accounts')
	await openCreationModal(page, 'Add Account')
	await creationDialog(page, 'Add Account')
		.getByLabel('Account name')
		.fill('Production detail checking')
	await creationDialog(page, 'Add Account').getByLabel('Account type').selectOption('bank')
	await creationDialog(page, 'Add Account')
		.getByRole('button', { name: 'Add Account', exact: true })
		.click()
	await expect(creationDialog(page, 'Add Account').getByRole('status')).toContainText(
		'Production detail checking'
	)
	await page.goto('/expenses/new')
	await page
		.getByLabel('Account', { exact: true })
		.selectOption({ label: 'Production detail checking' })
	await page.getByLabel('Amount', { exact: true }).fill('12.34')
	await page.getByLabel('Date', { exact: true }).fill('2026-03-10')
	await page.getByLabel('Description', { exact: true }).fill('Production detail verification')
	await page.getByRole('button', { name: 'Save transaction', exact: true }).click()
	await expect(page.getByRole('main').getByRole('status')).toHaveText('Transaction saved.')
	await page.goto('/expenses')
	const link = page
		.getByRole('main')
		.getByRole('link')
		.filter({ hasText: 'Production detail verification' })
	const href = await link.getAttribute('href')
	if (!href) throw new Error('Expected a transaction detail link.')
	const response = await page.goto(href)
	expect(response?.status()).toBe(200)
	expect(response?.fromServiceWorker()).toBe(false)
	// The dynamic server response contains the public startup shell, not account data.
	expect(await response?.text()).not.toContain('Production detail verification')
	await expect(
		page.getByRole('heading', { name: 'Transaction details', exact: true })
	).toBeVisible()
	await expect(page.getByRole('main')).toContainText('Production detail verification')
	await expect(page.getByRole('main')).toContainText('$12.34')
	await expect(page.getByRole('main').locator('time').first()).toHaveText('Mar 10, 2026')
	const reload = await page.reload()
	expect(reload?.status()).toBe(200)
	await expect(page.getByRole('main')).toContainText('Production detail verification')
})

test('serves the localized install manifest from the service worker while offline', async ({
	page,
	context
}) => {
	await context.setOffline(true)
	try {
		const responsePromise = page.waitForResponse(
			(response) => new URL(response.url()).pathname === '/manifest.webmanifest'
		)
		const manifest = await page.evaluate(async () => {
			const response = await fetch('/manifest.webmanifest', { cache: 'no-store' })
			return {
				status: response.status,
				contentType: response.headers.get('Content-Type'),
				value: await response.json()
			}
		})
		const response = await responsePromise
		expect(response.fromServiceWorker()).toBe(true)
		expect(manifest.status).toBe(200)
		expect(manifest.contentType).toContain('application/manifest+json')
		expect(manifest.value).toMatchObject({
			name: 'Delightful Finance',
			short_name: 'Delightful',
			description: 'A local-first personal finance tracker.',
			lang: 'en',
			dir: 'ltr',
			id: '/',
			start_url: '/',
			scope: '/'
		})
	} finally {
		await context.setOffline(false)
	}
})

test('a worker update preserves drafts in two tabs and activates after both close', async ({
	page,
	context
}) => {
	await page.goto('/accounts')
	await openCreationModal(page, 'Add Account')
	await creationDialog(page, 'Add Account').getByLabel('Account name').fill('First tab draft')
	const second = await context.newPage()
	await second.goto('/accounts')
	await openCreationModal(second, 'Add Account')
	await creationDialog(second, 'Add Account').getByLabel('Account name').fill('Second tab draft')
	await expect
		.poll(() => second.evaluate(() => Boolean(navigator.serviceWorker.controller)))
		.toBe(true)

	let firstNavigations = 0
	let secondNavigations = 0
	page.on('framenavigated', (frame) => {
		if (frame === page.mainFrame()) firstNavigations += 1
	})
	second.on('framenavigated', (frame) => {
		if (frame === second.mainFrame()) secondNavigations += 1
	})
	const firstController = await page.evaluateHandle(() => navigator.serviceWorker.controller)
	const secondController = await second.evaluateHandle(() => navigator.serviceWorker.controller)
	const workerPath = '.svelte-kit/output/client/service-worker.js'
	const original = await readFile(workerPath, 'utf8')
	try {
		const workerStarted = context.waitForEvent('serviceworker')
		await writeFile(workerPath, `${original}\n// Playwright multi-tab update fixture\n`)
		await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.ready
			await registration.update()
		})
		const updatedWorker = await workerStarted
		for (const tab of [page, second]) {
			await expect
				.poll(() => tab.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state))
				.toBe('installed')
		}
		expect(
			await page.evaluate((old) => navigator.serviceWorker.controller === old, firstController)
		).toBe(true)
		expect(
			await second.evaluate((old) => navigator.serviceWorker.controller === old, secondController)
		).toBe(true)
		await expect(creationDialog(page, 'Add Account').getByLabel('Account name')).toHaveValue(
			'First tab draft'
		)
		await expect(creationDialog(second, 'Add Account').getByLabel('Account name')).toHaveValue(
			'Second tab draft'
		)
		expect(firstNavigations).toBe(0)
		expect(secondNavigations).toBe(0)

		await page.close()
		await expect
			.poll(() => second.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state))
			.toBe('installed')
		expect(
			await second.evaluate((old) => navigator.serviceWorker.controller === old, secondController)
		).toBe(true)
		await expect(creationDialog(second, 'Add Account').getByLabel('Account name')).toHaveValue(
			'Second tab draft'
		)
		expect(secondNavigations).toBe(0)
		await second.close()

		// Observe the new worker without opening another controlled page during activation.
		await expect
			.poll(() =>
				updatedWorker.evaluate(
					'self.registration.waiting === null && self.registration.active?.state === "activated"'
				)
			)
			.toBe(true)
		const reopened = await context.newPage()
		await reopened.goto('/accounts')
		await openCreationModal(reopened, 'Add Account')
		await expect(creationDialog(reopened, 'Add Account').getByLabel('Account name')).toBeVisible()
		await expect
			.poll(() =>
				reopened.evaluate(async () => {
					const registration = await navigator.serviceWorker.ready
					return (
						!registration.waiting &&
						registration.active?.state === 'activated' &&
						navigator.serviceWorker.controller === registration.active
					)
				})
			)
			.toBe(true)
	} finally {
		await writeFile(workerPath, original)
		if (!second.isClosed()) await second.close()
	}
})
