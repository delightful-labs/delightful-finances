import { expect, test, type Page } from '@playwright/test'

async function seed(page: Page) {
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true })
	).toBeEnabled()
	await page.evaluate(async () => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		const [org] = await db.all(app.organizations)
		if (!org) throw new Error('Missing workspace')
		const account = await db
			.insert(app.accounts, {
				organizationId: org.id,
				name: 'Overview ledger',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier: 'local' })
		const euroAccount = await db
			.insert(app.accounts, {
				organizationId: org.id,
				name: 'Euro ledger',
				kind: 'cash',
				currency: 'EUR'
			})
			.wait({ tier: 'local' })

		const food = await db
			.insert(app.categories, {
				organizationId: org.id,
				name: 'Overview food',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'local' })
		const travel = await db
			.insert(app.categories, {
				organizationId: org.id,
				name: 'Overview travel',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'local' })
		function date(days: number) {
			const d = new Date()
			d.setDate(d.getDate() - days)
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
		}
		for (const row of [
			{
				description: 'Recent food',
				categoryId: food.id,
				amountMinor: 1000,
				bookedOn: date(0),
				currency: 'USD'
			},
			{
				description: 'Boundary food',
				categoryId: food.id,
				amountMinor: 2000,
				bookedOn: date(6),
				currency: 'USD'
			},
			{
				description: 'Older travel',
				categoryId: travel.id,
				amountMinor: 9000,
				bookedOn: date(29),
				currency: 'USD'
			},
			{
				description: 'Outside range',
				categoryId: food.id,
				amountMinor: 99999,
				bookedOn: date(30),
				currency: 'USD'
			},
			{
				description: 'Euro expense',
				categoryId: food.id,
				amountMinor: 500,
				bookedOn: date(0),
				currency: 'EUR'
			}
		])
			await db
				.insert(app.transactions, {
					...row,
					organizationId: org.id,
					accountId: row.currency === 'EUR' ? euroAccount.id : account.id,
					kind: 'expense',
					source: 'manual'
				})
				.wait({ tier: 'local' })
	})
	await page.goto('/')
	await expect(page.getByText('Recent food', { exact: true })).toBeVisible()
}

test('date presets, category selection, currencies, empty and invalid ranges', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 })
	await seed(page)
	const overview = page.getByRole('region', { name: 'Expenses by Category', exact: true })
	const legend = overview.locator('.legend')
	await expect(overview).toContainText('Total Expenses: $120.00')
	await expect(page.getByText('Outside range', { exact: true })).toHaveCount(0)
	await legend.getByRole('button', { name: /Overview travel/ }).click()
	await expect(page.getByText('Older travel', { exact: true })).toBeVisible()
	await expect(page.getByText('Recent food', { exact: true })).toHaveCount(0)
	await overview.getByRole('button', { name: 'All Categories', exact: true }).click()
	await expect(page.getByText('Recent food', { exact: true })).toBeVisible()
	// Keep a node reference: date changes must resize existing arcs, not remount them.
	await overview
		.locator('.chart path')
		.first()
		.evaluate((node) => {
			Reflect.set(window, 'overviewArc', node)
		})
	await overview.getByRole('button', { name: 'Last 7 Days', exact: true }).click()
	await expect(overview).toContainText('Total Expenses: $30.00')
	const frames = await overview.locator('.chart').evaluate(async (chart) => {
		const samples = []
		for (let frame = 0; frame < 10; frame++) {
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
			samples.push(
				[...chart.querySelectorAll('path')].map((path) => path.getAttribute('d')).join('|')
			)
		}
		return new Set(samples).size
	})
	expect(frames).toBeGreaterThan(1)

	await expect(page.getByText('Boundary food', { exact: true })).toBeVisible()
	await expect(page.getByText('Older travel', { exact: true })).toHaveCount(0)
	expect(
		await overview
			.locator('.chart path')
			.first()
			.evaluate((node) => Reflect.get(window, 'overviewArc') === node)
	).toBe(true)
	await overview.getByRole('button', { name: 'Last 30 Days', exact: true }).click()
	await expect(overview).toContainText('Total Expenses: $120.00')
	await overview.getByLabel('Currency').selectOption('EUR')
	await expect(page.getByText('Euro expense', { exact: true })).toBeVisible()
	await expect(page.getByText('Recent food', { exact: true })).toHaveCount(0)
	await overview.getByLabel('Start Date').fill('2000-01-01')
	await overview.getByLabel('End Date').fill('2000-01-02')
	await expect(overview).toContainText('No Expenses in this time period.')
	await overview.getByLabel('Start Date').fill('2001-01-01')
	await expect(overview.getByRole('status')).toContainText('Enter a start date')
})

test('slice clicks filter transactions and layout follows available width', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 })
	await seed(page)
	const overview = page.getByRole('region', { name: 'Expenses by Category', exact: true })
	const chart = overview.locator('.chart')
	const list = overview.locator('.transactions')
	const desktopChart = await chart.boundingBox()
	const desktopList = await list.boundingBox()
	if (!desktopChart || !desktopList) throw new Error('Missing layout')
	expect(desktopList.x).toBeGreaterThan(desktopChart.x + desktopChart.width - 1)
	await overview.locator('.chart path').filter({ visible: true }).first().click({ force: true })
	await expect(overview.locator('.legend button[aria-pressed="true"]')).toHaveCount(1)
	await overview.getByRole('button', { name: 'All Categories', exact: true }).click()
	await page.setViewportSize({ width: 390, height: 900 })
	await page.getByRole('button', { name: 'Close Main navigation', exact: true }).click()
	await expect
		.poll(async () => {
			const chartBox = await chart.boundingBox()
			const listBox = await list.boundingBox()
			return Boolean(chartBox && listBox && listBox.y > chartBox.y + chartBox.height)
		})
		.toBe(true)
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	)
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await overview.getByRole('button', { name: 'Last 7 Days', exact: true }).click()
	await expect(overview).toContainText('Total Expenses: $30.00')
})

test('overview filters persist in this tab across page navigation', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 })
	await seed(page)
	const overview = page.getByRole('region', { name: 'Expenses by Category', exact: true })
	const start = overview.getByLabel('Start Date')
	const end = overview.getByLabel('End Date')
	await overview.getByRole('button', { name: 'Last 7 Days', exact: true }).click()
	const savedStart = await start.inputValue()
	const savedEnd = await end.inputValue()
	await overview.getByLabel('Currency').selectOption('EUR')
	await overview
		.locator('.legend')
		.getByRole('button', { name: /Overview food/ })
		.click()
	await expect(overview.locator('.legend button[aria-pressed="true"]')).toHaveCount(1)
	const storedFilters = await page.evaluate(() => {
		const key = Object.keys(sessionStorage).find((item) =>
			item.startsWith('finance-overview-filters:')
		)
		return key ? { key, value: sessionStorage.getItem(key) } : null
	})
	expect(storedFilters).not.toBeNull()
	expect(storedFilters?.value).toContain(savedStart)
	expect(storedFilters?.value).toContain(savedEnd)

	await page.getByRole('link', { name: 'Expenses', exact: true }).click()
	await expect(page).toHaveURL(/\/expenses/)
	await page.getByRole('link', { name: 'Overview', exact: true }).click()
	const restoredOverview = page.getByRole('region', { name: 'Expenses by Category', exact: true })
	await expect(restoredOverview.getByLabel('Start Date')).toHaveValue(savedStart)
	await expect(restoredOverview.getByLabel('End Date')).toHaveValue(savedEnd)
	await expect(restoredOverview.getByLabel('Currency')).toHaveValue('EUR')
	await expect(restoredOverview.locator('.legend button[aria-pressed="true"]')).toHaveCount(1)
	await expect(restoredOverview.locator('.legend button[aria-pressed="true"]')).toContainText(
		'Overview food'
	)
})
