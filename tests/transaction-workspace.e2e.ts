import { pageContent } from './helpers/ui.js'
import { expect, test, type Page } from '@playwright/test'

async function seed(
	page: Page,
	count = 0,
	kind: 'expense' | 'income' = 'expense',
	bookedOn = '2026-10-19'
) {
	await page.goto('/accounts')
	await expect(
		pageContent(page).getByRole('button', { name: 'Add Account', exact: true })
	).toBeEnabled({ timeout: 30_000 })
	return page.evaluate(
		async ({ count, kind, bookedOn }) => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			const [organization] = await db.all(app.organizations)
			if (!organization) throw new Error('Missing organization')
			const account = await db
				.insert(app.accounts, {
					organizationId: organization.id,
					name: 'Workspace ledger',
					kind: 'cash',
					currency: 'USD'
				})
				.wait({ tier: 'local' })
			const category = (
				await db.all(app.categories.where({ organizationId: organization.id, kind }))
			)[0]
			if (!category) throw new Error('Missing transaction category')
			for (let index = 0; index < count; index++) {
				await db
					.insert(app.transactions, {
						organizationId: organization.id,
						accountId: account.id,
						categoryId: category.id,
						kind,
						amountMinor: 100,
						currency: 'USD',
						bookedOn,
						description: `Seed ${index}`,
						source: 'manual'
					})
					.wait({ tier: 'local' })
			}
			return organization.id
		},
		{ count, kind, bookedOn }
	)
}

for (const desktop of [true, false]) {
	for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
		test(
			`${desktop ? 'desktop' : 'mobile'} ${kind} list filters combine and retain search across reloads`,
			{ tag: ['@transactions'] },
			async ({ page }) => {
				await page.setViewportSize({ width: desktop ? 1440 : 390, height: 900 })
				const dates = await page.evaluate(() => {
					function dateOnly(offset: number) {
						const date = new Date()
						date.setDate(date.getDate() + offset)
						return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
					}
					return {
						today: dateOnly(0),
						week: dateOnly(-6),
						month: dateOnly(-29),
						older: dateOnly(-12),
						tomorrow: dateOnly(1)
					}
				})
				const workspaceId = await seed(page, 27, kind, dates.older)
				const path = kind === 'income' ? '/income' : '/expenses'
				await page.goto(`${path}?workspace=${workspaceId}`)
				const initialList = pageContent(page)
				await expect(initialList.locator('.entries > li')).toHaveCount(25)
				await expect(
					initialList.getByRole('combobox', { name: 'Filter Currency', exact: true })
				).toHaveCount(0)
				const fixture = await page.evaluate(
					async ({ workspaceId, kind, bookedOn }) => {
						const schemaPath = '/src/lib/schema.ts'
						const sessionPath = '/src/lib/runtime/jazz-session.ts'
						const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
						const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
							await import(sessionPath)
						const db = getCurrentJazzSession()?.getSnapshot().client?.db
						if (!db) throw new Error('Missing database')
						const account = await db
							.insert(app.accounts, {
								organizationId: workspaceId,
								name: 'TZS ledger',
								kind: 'cash',
								currency: 'TZS'
							})
							.wait({ tier: 'local' })
						const category = await db
							.insert(app.categories, {
								organizationId: workspaceId,
								name: 'Travel filter',
								kind,
								isSystem: false
							})
							.wait({ tier: 'local' })
						const tag = await db
							.insert(app.tags, {
								organizationId: workspaceId,
								name: 'Business tag',
								kind,
								categoryId: category.id
							})
							.wait({ tier: 'local' })
						const row = await db
							.insert(app.transactions, {
								organizationId: workspaceId,
								accountId: account.id,
								categoryId: category.id,
								kind,
								amountMinor: 1234,
								currency: 'TZS',
								bookedOn,
								description: 'Conference ticket',
								memo: 'Client visit',
								source: 'manual'
							})
							.wait({ tier: 'local' })
						await db
							.insert(app.transactionTags, {
								organizationId: workspaceId,
								transactionId: row.id,
								tagId: tag.id
							})
							.wait({ tier: 'local' })
						return { categoryId: category.id }
					},
					{ workspaceId, kind, bookedOn: dates.today }
				)
				await page.goto(`${path}?workspace=${workspaceId}`)
				const main = pageContent(page)
				const rows = main.locator('.entries > li')
				const search = main.getByRole('searchbox', { name: 'Search Transactions', exact: true })
				await expect(rows).toHaveCount(25)
				const filterGroup = main.getByRole('group', { name: 'Filter Transactions', exact: true })
				await expect(filterGroup).toHaveCSS('border-top-width', '0px')
				await expect(filterGroup).toHaveCSS('margin-top', '0px')
				await expect(filterGroup).toHaveCSS('padding-top', '0px')
				await expect(
					main.getByRole('combobox', { name: 'Filter Currency', exact: true })
				).toBeVisible()
				await main.getByRole('link', { name: 'Page 2', exact: true }).click()
				await expect(rows).toHaveCount(3)
				await search.fill('  CLIENT business TRAVEL ticket ')
				await expect(page).toHaveURL(
					(url) =>
						!url.searchParams.has('page') &&
						url.searchParams.get('q') === '  CLIENT business TRAVEL ticket '
				)
				await expect(rows).toHaveCount(1)
				await expect(rows).toContainText('Conference ticket')
				await expect(main.getByLabel('Daily total: TSh 12.34', { exact: true })).toBeVisible()
				await main
					.getByRole('combobox', { name: 'Filter Category', exact: true })
					.selectOption(fixture.categoryId)
				await main
					.getByRole('combobox', { name: 'Filter Currency', exact: true })
					.selectOption('TZS')
				await main.getByLabel('Start Date', { exact: true }).fill(dates.today)
				await main.getByLabel('End Date', { exact: true }).fill(dates.today)
				await expect(rows).toHaveCount(1)
				await page.reload()
				await expect(search).toHaveValue('  CLIENT business TRAVEL ticket ')
				await expect(
					main.getByRole('combobox', { name: 'Filter Category', exact: true })
				).toHaveValue(fixture.categoryId)
				await expect(
					main.getByRole('combobox', { name: 'Filter Currency', exact: true })
				).toHaveValue('TZS')
				await expect(rows).toHaveCount(1)
				await main
					.getByRole('combobox', { name: 'Filter Currency', exact: true })
					.selectOption('USD')
				await expect(rows).toHaveCount(0)
				await main.getByRole('combobox', { name: 'Filter Currency', exact: true }).selectOption('')
				await main.getByRole('combobox', { name: 'Filter Category', exact: true }).selectOption('')
				await search.fill('')
				await main.getByRole('button', { name: 'Last 7 Days', exact: true }).click()
				await expect(main.getByLabel('Start Date', { exact: true })).toHaveValue(dates.week)
				await expect(rows).toHaveCount(1)
				await main.getByRole('button', { name: 'Last 30 Days', exact: true }).click()
				await expect(main.getByLabel('Start Date', { exact: true })).toHaveValue(dates.month)
				await expect(rows).toHaveCount(25)
				await expect(main.getByLabel('Daily total: $27.00', { exact: true })).toBeVisible()
				await search.fill('Seed')
				await main.getByRole('link', { name: 'Page 2', exact: true }).click()
				await expect(rows).toHaveCount(2)
				await expect(search).toHaveValue('Seed')
				await expect(page).toHaveURL(
					(url) => url.searchParams.get('q') === 'Seed' && url.searchParams.get('page') === '2'
				)
				await search.fill('no matching transaction')
				await expect(rows).toHaveCount(0)
				await expect(main.getByText('Your recent activity will appear here.')).toBeVisible()
				await main.getByLabel('Start Date', { exact: true }).fill(dates.tomorrow)
				await expect(
					main.getByText('Enter a start date and an end date on or after the start date.')
				).toBeVisible()
				if (!desktop)
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
					).toBe(true)
			}
		)
	}
}

async function expectWorkspaceUrl(
	page: Page,
	path: string,
	workspaceId: string,
	pageNumber?: string
) {
	await expect(page).toHaveURL(
		(url) =>
			url.pathname === path &&
			url.searchParams.get('workspace') === workspaceId &&
			url.searchParams.get('page') === (pageNumber ?? null)
	)
}

async function savedCount(page: Page, description: string) {
	return page.evaluate(async (description) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		return (await db.all(app.transactions)).filter((row) => row.description === description).length
	}, description)
}

for (const desktop of [true, false]) {
	for (const kind of ['expense', 'income']) {
		const base = kind === 'income' ? '/income' : '/expenses'
		const label = kind === 'income' ? 'Add Income' : 'Add Expenses'
		for (const valid of [false, true]) {
			test(
				`${desktop ? 'desktop' : 'mobile'} ${kind} Cancel returns to its section without saving ${valid ? 'a valid' : 'an invalid'} draft`,
				{ tag: ['@transactions'] },
				async ({ page }) => {
					await page.setViewportSize({ width: desktop ? 1440 : 390, height: 900 })
					const workspaceId = await seed(page)
					await page.goto(`${base}/new`)
					const main = pageContent(page)
					const amount = main.getByLabel('Amount', { exact: true })
					await expect(amount).toBeEnabled()
					await main.getByLabel('Description', { exact: true }).fill('Cancelled draft')
					if (valid) await amount.fill('12.34')
					expect(
						await main
							.locator('form')
							.evaluate((form) => form instanceof HTMLFormElement && form.checkValidity())
					).toBe(valid)
					const cancel = main.getByRole('button', { name: 'Cancel', exact: true })
					await expect(cancel).toHaveAttribute('type', 'button')
					await expect(cancel).not.toHaveClass(/\bprimary\b/)
					await expect(
						main.getByRole('button', { name: 'Save Transaction', exact: true })
					).toHaveClass(/\bprimary\b/)
					await cancel.click()
					await expectWorkspaceUrl(page, base, workspaceId)
					await expect(
						main.getByRole('heading', {
							name: kind === 'income' ? 'Income' : 'Expenses',
							exact: true
						})
					).toBeVisible()
					await expect.poll(() => savedCount(page, 'Cancelled draft')).toBe(0)
				}
			)
		}
		test(
			`${desktop ? 'desktop' : 'mobile'} ${kind} goes directly from creation to its section, including offline`,
			{ tag: ['@transactions'] },
			async ({ page, context }) => {
				await page.setViewportSize({ width: desktop ? 1440 : 390, height: 900 })
				const workspaceId = await seed(page)
				await page.goto(base)
				const main = pageContent(page)
				const drawer = main.locator('aside[data-side="right"]')
				if (desktop) {
					await expect(drawer).toHaveAttribute('data-open', 'true')
					await expect(main.locator('.transaction-content')).toHaveText('', { useInnerText: true })
				} else await expect(drawer).toHaveCount(0)
				await main.getByRole('link', { name: label, exact: true }).click()
				await expectWorkspaceUrl(page, `${base}/new`, workspaceId)
				const amount = main.getByLabel('Amount', { exact: true })
				await expect(amount).toBeEnabled()
				await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
				await expectWorkspaceUrl(page, `${base}/new`, workspaceId)
				await expect.poll(() => savedCount(page, 'Saved directly')).toBe(0)
				if (desktop) await expect(drawer).toBeVisible()
				else await expect(main.locator('.entries')).toHaveCount(0)
				await amount.fill('12.34')
				await main.getByLabel('Description', { exact: true }).fill('Saved directly')
				if (desktop) {
					await page.setViewportSize({ width: 390, height: 900 })
					await expect(amount).toHaveValue('12.34')
					await expect(drawer).toHaveCount(0)
					await page.setViewportSize({ width: 1440, height: 900 })
					await expect(amount).toHaveValue('12.34')
				}
				await page.evaluate(() => {
					document.documentElement.dataset.creationFlash = 'no'
					const observer = new MutationObserver(() => {
						if (
							location.pathname.endsWith('/new') &&
							/Add another Transaction|Transaction saved\./.test(
								document.querySelector('main')?.textContent ?? ''
							)
						) {
							document.documentElement.dataset.creationFlash = 'yes'
						}
					})
					observer.observe(document.body, { childList: true, subtree: true })
				})
				await context.setOffline(true)
				await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
				await expectWorkspaceUrl(page, base, workspaceId)
				await expect(main.getByText('Saved directly', { exact: true })).toBeVisible()
				expect(await page.locator('html').getAttribute('data-creation-flash')).toBe('no')
				await expect.poll(() => savedCount(page, 'Saved directly')).toBe(1)
				await context.setOffline(false)
				await page.goBack()
				await expectWorkspaceUrl(page, base, workspaceId)
				await page.goForward()
				await expectWorkspaceUrl(page, base, workspaceId)
				await main.getByRole('link', { name: /Transaction details:.*Saved directly/ }).click()
				await expect(page).toHaveURL(
					(url) =>
						url.pathname.startsWith(`${base}/`) &&
						!url.pathname.endsWith('/new') &&
						url.searchParams.get('workspace') === workspaceId
				)
				await expect(amount).toHaveValue('12.34')
				await expect(amount).toBeEnabled()
				await expect(
					main.getByRole('button', { name: 'Save Transaction', exact: true })
				).toHaveClass(/\bprimary\b/)
				await amount.fill('15.00')
				await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
				await expect(main.getByText('Transaction saved.', { exact: true })).toBeVisible()
				await expect(page).not.toHaveURL((url) => url.pathname === base)
				await expect.poll(() => savedCount(page, 'Saved directly')).toBe(1)
				await page.reload()
				await expect(amount).toHaveValue('15.00')
			}
		)
	}
}

test(
	'desktop drawer closes/reopens and preserves pagination through selection, creation and reload',
	{ tag: ['@transactions'] },
	async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		const workspaceId = await seed(page, 26)
		await page.goto('/expenses')
		const main = pageContent(page)
		const drawer = main.locator('aside[data-side="right"]')
		await expect(drawer).toHaveAttribute('data-open', 'true')
		await drawer.getByRole('button', { name: 'Close Transactions', exact: true }).click()
		await expect(drawer).toHaveAttribute('aria-hidden', 'true')
		const reopen = main.getByRole('button', { name: 'Open Transactions', exact: true })
		await reopen.click()
		await drawer.locator('.entries a').first().focus()
		await page.keyboard.press('Escape')
		await expect(drawer).toHaveAttribute('aria-hidden', 'true')
		await expect(reopen).toBeFocused()
		await reopen.click()
		const day = drawer.locator('details').first()
		await expect(day).toHaveAttribute('open', '')
		await day.locator('summary').click()
		await expect(day).not.toHaveAttribute('open', '')
		await day.locator('summary').click()
		await drawer.getByRole('link', { name: 'Page 2', exact: true }).click()
		await expectWorkspaceUrl(page, '/expenses', workspaceId, '2')
		await expect(drawer.locator('.entries > li')).toHaveCount(1)
		const item = drawer.locator('.entries > li').first()
		await expect(item.getByRole('link')).toHaveCount(1)
		await expect(item).not.toContainText('Workspace ledger')
		await item.hover()
		const colors = await item.evaluate((element) => ({
			background: getComputedStyle(element).backgroundColor,
			text: getComputedStyle(element.querySelector('.classification span') ?? element).color,
			chevron: getComputedStyle(element.querySelector('svg') ?? element).color
		}))
		expect(colors).toEqual({
			background: 'rgb(148, 255, 71)',
			text: 'rgb(38, 38, 38)',
			chevron: 'rgb(38, 38, 38)'
		})
		await item.getByRole('link').click()
		await expect(page).toHaveURL(
			(url) =>
				/^\/expenses\/[^/]+$/.test(url.pathname) &&
				url.searchParams.get('workspace') === workspaceId &&
				url.searchParams.get('page') === '2'
		)
		await expect(main.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
		await expect(drawer.locator('.entries > li')).toHaveCount(1)
		await page.reload()
		await expect(main.getByLabel('Amount', { exact: true })).toHaveValue('1.00')
		await expect(drawer).toHaveAttribute('data-open', 'true')
		await expect(drawer.locator('.entries > li')).toHaveCount(1)
		await drawer.getByRole('link', { name: 'Add Expenses', exact: true }).click()
		await expectWorkspaceUrl(page, '/expenses/new', workspaceId, '2')
		await expect(main.getByLabel('Amount', { exact: true })).toHaveValue('')
		await expect(drawer.locator('.entries > li')).toHaveCount(1)
	}
)

for (const kind of ['income', 'expense']) {
	test(
		`sample ${kind} batches persist 25 items offline and can run again`,
		{ tag: ['@transactions'] },
		async ({ page, context }) => {
			await seed(page)
			const trigger = page.getByRole('button', { name: 'Developer menu', exact: true })
			await trigger.focus()
			await trigger.click()
			const dialog = page.getByRole('dialog', { name: 'Developer menu', exact: true })
			const subject = kind === 'income' ? 'Income' : 'Expense'
			const add = dialog.getByRole('button', {
				name: `Add 25 sample ${subject} Transactions`,
				exact: true
			})
			await expect(add).toBeEnabled({ timeout: 30_000 })
			await context.setOffline(true)
			try {
				for (const count of [25, 50]) {
					await add.click()
					await expect(dialog.getByRole('status')).toHaveText('Saved 25 of 25 sample transactions.')
					await expect(add).toBeEnabled()
					await expect
						.poll(() =>
							page.evaluate(async (kind) => {
								const schemaPath = '/src/lib/schema.ts'
								const sessionPath = '/src/lib/runtime/jazz-session.ts'
								const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
								const {
									getCurrentJazzSession
								}: typeof import('../src/lib/runtime/jazz-session.js') = await import(sessionPath)
								const db = getCurrentJazzSession()?.getSnapshot().client?.db
								if (!db) throw new Error('Missing database')
								return (await db.all(app.transactions)).filter((row) => row.kind === kind).length
							}, kind)
						)
						.toBe(count)
				}
			} finally {
				await context.setOffline(false)
			}
		}
	)
}
