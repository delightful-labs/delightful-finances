import { expect, test as base, type ConsoleMessage, type Page } from '@playwright/test'
import type { OrganizationMember } from '../src/lib/schema.js'

const test = base.extend<{ ownershipWarnings: string[] }>({
	ownershipWarnings: [
		async ({ page }, use) => {
			const warnings: string[] = []
			const capture = (message: ConsoleMessage) => {
				if (/ownership_invalid_(mutation|binding)/.test(message.text()))
					warnings.push(message.text())
			}
			page.on('console', capture)
			try {
				await use(warnings)
			} finally {
				page.off('console', capture)
				expect(warnings, 'Svelte ownership warnings').toEqual([])
			}
		},
		{ auto: true }
	]
})

declare global {
	interface Window {
		workspaceSettingsTest: {
			db: ReturnType<typeof import('jazz-tools/svelte').getDb>
			app: typeof import('../src/lib/schema.js').app
			userId: string
		}
	}
}

async function start(page: Page) {
	await page.goto('/settings/workspace')
	await expect(page.getByLabel('Workspace name')).toBeVisible()
	await page.evaluate(async () => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client || !snapshot.account) throw new Error('Test session is not ready.')
		window.workspaceSettingsTest = {
			db: snapshot.client.db,
			app,
			userId: snapshot.account.id
		}
	})
}

test('owner can rename, reject whitespace, retry, and retain the name after reload', async ({
	page
}) => {
	await start(page)
	const workspaceId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const name = page.getByLabel('Workspace name')
	const save = page.getByRole('button', { name: 'Save', exact: true })
	await name.fill('   ')
	await save.click()
	await expect(page.getByRole('alert')).toHaveText('Enter a workspace name.')
	await name.fill('  Household  ')
	await save.click()
	await expect(page.getByRole('status')).toHaveText('Workspace name saved on this device.')
	await expect(page.getByLabel('Workspace', { exact: true }).locator('option:checked')).toHaveText(
		'Household'
	)
	await page.reload()
	await expect(name).toHaveValue('Household')
	await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue(workspaceId)
	await expect(save).toBeEnabled()
})

test('sidebar navigation preserves the selected workspace and database session', async ({
	page
}) => {
	await start(page)
	const workspaceId = await page.evaluate(async () => {
		const { app, db, userId } = window.workspaceSettingsTest
		const workspace = await db
			.insert(app.organizations, {
				name: 'Navigation workspace',
				kind: 'business',
				defaultCurrency: 'USD',
				ownerId: userId
			})
			.wait({ tier: 'global' })
		await db
			.insert(app.organizationMembers, {
				organizationId: workspace.id,
				userId,
				role: 'owner',
				accountAccessMode: 'all'
			})
			.wait({ tier: 'global' })
		return workspace.id
	})
	const selector = page.getByLabel('Workspace', { exact: true })
	await expect(selector.locator(`option[value="${workspaceId}"]`)).toHaveCount(1)
	await selector.selectOption(workspaceId)
	await expect(page.getByLabel('Workspace name')).toHaveValue('Navigation workspace')
	const navigation = page.getByRole('navigation', { name: 'Main navigation' })
	await navigation.getByRole('link', { name: 'Overview', exact: true }).click()
	await expect(page).toHaveURL('/')
	const link = navigation.getByRole('link', { name: 'Workspace', exact: true })
	await expect(link).toHaveAttribute('href', '/settings/workspace')
	await link.click()
	await expect(page).toHaveURL('/settings/workspace')
	await expect(selector).toHaveValue(workspaceId)
	await expect(page.getByLabel('Workspace name')).toHaveValue('Navigation workspace')
	await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
	// The binding survives only client navigation and still points to the active client.
	expect(
		await page.evaluate(async () => {
			const sessionPath = '/src/lib/jazz-session.ts'
			const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
				sessionPath
			)
			return window.workspaceSettingsTest.db === getCurrentJazzSession()?.getSnapshot().client?.db
		})
	).toBe(true)
})

test('account list shows an empty result and newly created accounts', async ({ page }) => {
	await page.goto('/accounts')
	const main = page.getByRole('main')
	await expect(main.getByText('Start with one place you keep money.')).toBeVisible()
	await expect(main.getByRole('table')).toHaveCount(0)
	await main.getByRole('link', { name: 'Add an account' }).click()
	await page.getByLabel('Account name').fill('Everyday checking')
	await page.getByLabel('Account type').selectOption('bank')
	await page.getByRole('button', { name: 'Add an account' }).click()
	await expect(page.getByRole('status')).toContainText('Everyday checking')
	await page.getByRole('navigation').getByRole('link', { name: 'Accounts', exact: true }).click()
	await expect(main.getByRole('cell', { name: 'Everyday checking', exact: true })).toBeVisible()
	await expect(main.getByRole('cell', { name: 'Bank', exact: true })).toBeVisible()
	await expect(main.getByRole('cell', { name: 'USD', exact: true })).toBeVisible()
	await expect(main.getByText('Start with one place you keep money.')).toHaveCount(0)
	await page.reload()
	await expect(main.getByRole('cell', { name: 'Everyday checking', exact: true })).toBeVisible()
})

test('account form rejects whitespace and allows corrected cash, bank, and card submissions', async ({
	page
}) => {
	for (const kind of ['cash', 'bank', 'card']) {
		await page.goto('/accounts/new')
		await page.getByLabel('Account name').fill('   ')
		await page.getByLabel('Account type').selectOption(kind)
		await page.getByRole('button', { name: 'Add an account' }).click()
		await expect(page.getByRole('main').getByRole('alert')).toHaveText(
			'Enter an account name and select an account type.'
		)
		await expect(page.getByLabel('Account type')).toHaveValue(kind)
		await page.getByLabel('Account name').fill(`  Test ${kind}  `)
		await page.getByRole('button', { name: 'Add an account' }).click()
		await expect(page.getByRole('main').getByRole('status')).toHaveText(
			`Account Test ${kind} saved.`
		)
		await page.getByRole('navigation').getByRole('link', { name: 'Accounts', exact: true }).click()
		await expect(
			page.getByRole('main').getByRole('cell', { name: `Test ${kind}`, exact: true })
		).toHaveCount(1)
	}
})

test('account form resets its draft and saves to the selected workspace', async ({ page }) => {
	await start(page)
	const firstWorkspaceId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const secondWorkspaceId = await page.evaluate(async () => {
		const { app, db, userId } = window.workspaceSettingsTest
		const workspace = await db
			.insert(app.organizations, {
				name: 'Account form workspace',
				kind: 'business',
				defaultCurrency: 'USD',
				ownerId: userId
			})
			.wait({ tier: 'global' })
		await db
			.insert(app.organizationMembers, {
				organizationId: workspace.id,
				userId,
				role: 'owner',
				accountAccessMode: 'all'
			})
			.wait({ tier: 'global' })
		return workspace.id
	})
	await page.getByRole('navigation').getByRole('link', { name: 'Accounts', exact: true }).click()
	await page.getByRole('main').getByRole('link', { name: 'Add an account' }).click()
	await page.getByLabel('Account name').fill('Previous workspace draft')
	await page.getByLabel('Account type').selectOption('cash')
	const selector = page.getByLabel('Workspace', { exact: true })
	await selector.selectOption(secondWorkspaceId)
	await expect(page.getByLabel('Account name')).toHaveValue('')
	await expect(page.getByLabel('Account type')).toHaveValue('')
	await page.getByLabel('Account name').fill('Business checking')
	await page.getByLabel('Account type').selectOption('bank')
	await page.getByRole('button', { name: 'Add an account' }).click()
	await expect(page.getByRole('main').getByRole('status')).toHaveText(
		'Account Business checking saved.'
	)
	await selector.selectOption(firstWorkspaceId)
	await expect(page.getByLabel('Account name')).toHaveValue('')
	await expect(page.getByRole('main').getByRole('status')).toHaveCount(0)
	await page.getByRole('navigation').getByRole('link', { name: 'Accounts', exact: true }).click()
	await expect(
		page.getByRole('main').getByText('Start with one place you keep money.')
	).toBeVisible()
	await selector.selectOption(secondWorkspaceId)
	await expect(
		page.getByRole('main').getByRole('cell', { name: 'Business checking', exact: true })
	).toBeVisible()
})

test('account list sorts active accounts, updates live, and follows workspace selection', async ({
	page
}) => {
	await start(page)
	const firstWorkspaceId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const fixture = await page.evaluate(async (organizationId) => {
		const { app, db, userId } = window.workspaceSettingsTest
		const second = await db
			.insert(app.organizations, {
				name: 'Other ledger',
				kind: 'business',
				defaultCurrency: 'USD',
				ownerId: userId
			})
			.wait({ tier: 'global' })
		await db
			.insert(app.organizationMembers, {
				organizationId: second.id,
				userId,
				role: 'owner',
				accountAccessMode: 'all'
			})
			.wait({ tier: 'global' })
		const accounts = [
			{ organizationId, name: 'Zebra checking', kind: 'bank', archivedAt: null },
			{ organizationId, name: 'Alpha cash', kind: 'cash', archivedAt: null },
			{ organizationId, name: 'Archived card', kind: 'card', archivedAt: new Date() },
			{ organizationId: second.id, name: 'Business card', kind: 'card', archivedAt: null }
		] satisfies Pick<
			import('../src/lib/schema.js').Account,
			'organizationId' | 'name' | 'kind' | 'archivedAt'
		>[]
		const ids: string[] = []
		for (const account of accounts) {
			const row = await db
				.insert(app.accounts, { ...account, archivedAt: null, currency: 'USD' })
				.wait({ tier: 'global' })
			if (account.archivedAt)
				await db
					.update(app.accounts, row.id, { archivedAt: account.archivedAt })
					.wait({ tier: 'global' })
			ids.push(row.id)
		}
		return { secondWorkspaceId: second.id, firstAccountId: ids[0] }
	}, firstWorkspaceId)
	await page.getByRole('navigation').getByRole('link', { name: 'Accounts', exact: true }).click()
	const main = page.getByRole('main')
	const names = main.getByRole('table').locator('tbody tr td:first-child')
	await expect(names).toHaveText(['Alpha cash', 'Zebra checking'])
	await expect(main.getByRole('cell', { name: 'Archived card', exact: true })).toHaveCount(0)
	const selector = page.getByLabel('Workspace', { exact: true })
	await selector.selectOption(fixture.secondWorkspaceId)
	await expect(names).toHaveText(['Business card'])
	await selector.selectOption(firstWorkspaceId)
	await expect(names).toHaveText(['Alpha cash', 'Zebra checking'])
	await page.evaluate(async (id) => {
		if (!id) throw new Error('Test account is missing.')
		const { app, db } = window.workspaceSettingsTest
		await db.update(app.accounts, id, { archivedAt: new Date() }).wait({ tier: 'global' })
	}, fixture.firstAccountId)
	await expect(names).toHaveText(['Alpha cash'])
})

test('transaction list shows empty income and expense views', async ({ page }) => {
	await page.goto('/expenses')
	const main = page.getByRole('main')
	await expect(main.getByText('Your recent activity will appear here.')).toBeVisible()
	await expect(main.getByRole('table')).toHaveCount(0)
	await expect(main.getByRole('link', { name: 'Add expense' })).toHaveAttribute(
		'href',
		'/expenses/new'
	)
	await page.getByRole('navigation').getByRole('link', { name: 'Income', exact: true }).click()
	await expect(page).toHaveURL('/incomes')
	await expect(main.getByText('Your recent activity will appear here.')).toBeVisible()
	await expect(main.getByRole('link', { name: 'Add income' })).toHaveAttribute(
		'href',
		'/incomes/new'
	)
})

test('transaction list follows kind, date order, account filters, and workspace selection', async ({
	page
}) => {
	await start(page)
	const firstWorkspaceId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const fixture = await page.evaluate(async (organizationId) => {
		const { app, db, userId } = window.workspaceSettingsTest
		const second = await db
			.insert(app.organizations, {
				name: 'Other transactions',
				kind: 'business',
				defaultCurrency: 'USD',
				ownerId: userId
			})
			.wait({ tier: 'global' })
		await db
			.insert(app.organizationMembers, {
				organizationId: second.id,
				userId,
				role: 'owner',
				accountAccessMode: 'all'
			})
			.wait({ tier: 'global' })
		const checking = await db
			.insert(app.accounts, { organizationId, name: 'Checking', kind: 'bank', currency: 'USD' })
			.wait({ tier: 'global' })
		const cash = await db
			.insert(app.accounts, { organizationId, name: 'Cash', kind: 'cash', currency: 'USD' })
			.wait({ tier: 'global' })
		const business = await db
			.insert(app.accounts, {
				organizationId: second.id,
				name: 'Business',
				kind: 'bank',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		const expense = await db
			.insert(app.categories, {
				organizationId,
				name: 'Test expenses',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'global' })
		const income = await db
			.insert(app.categories, {
				organizationId,
				name: 'Test income',
				kind: 'income',
				isSystem: false
			})
			.wait({ tier: 'global' })
		const businessExpense = await db
			.insert(app.categories, {
				organizationId: second.id,
				name: 'Business expenses',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'global' })
		const rows = [
			{
				organizationId,
				accountId: checking.id,
				categoryId: expense.id,
				kind: 'expense',
				bookedOn: '2026-10-01',
				memo: 'Older expense'
			},
			{
				organizationId,
				accountId: cash.id,
				categoryId: expense.id,
				kind: 'expense',
				bookedOn: '2026-10-12',
				memo: 'Recent expense'
			},
			{
				organizationId,
				accountId: checking.id,
				categoryId: income.id,
				kind: 'income',
				bookedOn: '2026-10-05',
				memo: 'Salary'
			},
			{
				organizationId: second.id,
				accountId: business.id,
				categoryId: businessExpense.id,
				kind: 'expense',
				bookedOn: '2026-10-13',
				memo: 'Business expense'
			}
		] satisfies Pick<
			import('../src/lib/schema.js').TransactionRow,
			'organizationId' | 'accountId' | 'categoryId' | 'kind' | 'bookedOn' | 'memo'
		>[]
		for (const row of rows)
			await db
				.insert(app.transactions, {
					...row,
					amountMinor: 1234,
					currency: 'USD',
					source: 'manual',
					...(row.kind === 'income' ? { paymentMethod: 'cash' } : {})
				})
				.wait({ tier: 'global' })
		return { secondWorkspaceId: second.id, accountId: checking.id, categoryId: expense.id }
	}, firstWorkspaceId)
	const navigation = page.getByRole('navigation')
	await navigation.getByRole('link', { name: 'Expenses', exact: true }).click()
	const main = page.getByRole('main')
	const memos = main.getByRole('table').locator('tbody tr td:last-child')
	await expect(memos).toHaveText(['Recent expense', 'Older expense'])
	await expect(main.getByRole('cell', { name: '$12.34', exact: true })).toHaveCount(2)
	await page.getByRole('checkbox', { name: 'Show Cash', exact: true }).uncheck()
	await expect(memos).toHaveText(['Older expense'])
	await page.getByRole('checkbox', { name: 'All accounts', exact: true }).check()
	await expect(memos).toHaveText(['Recent expense', 'Older expense'])
	await page.getByRole('checkbox', { name: 'All accounts', exact: true }).uncheck()
	await expect(main.getByText('Turn on an account to see its transactions.')).toBeVisible()
	await expect(main.getByRole('table')).toHaveCount(0)
	await page.getByRole('checkbox', { name: 'All accounts', exact: true }).check()
	await expect(memos).toHaveText(['Recent expense', 'Older expense'])
	await navigation.getByRole('link', { name: 'Income', exact: true }).click()
	await expect(memos).toHaveText(['Salary'])
	await navigation.getByRole('link', { name: 'Expenses', exact: true }).click()
	const selector = page.getByLabel('Workspace', { exact: true })
	await selector.selectOption(fixture.secondWorkspaceId)
	await expect(memos).toHaveText(['Business expense'])
	await selector.selectOption(firstWorkspaceId)
	await expect(memos).toHaveText(['Recent expense', 'Older expense'])
	await page.evaluate(
		async ({ organizationId, accountId, categoryId }) => {
			const { app, db } = window.workspaceSettingsTest
			await db
				.insert(app.transactions, {
					organizationId,
					accountId,
					categoryId,
					kind: 'expense',
					bookedOn: '2026-10-13',
					memo: 'Live expense',
					amountMinor: 100,
					currency: 'USD',
					source: 'manual'
				})
				.wait({ tier: 'global' })
		},
		{ organizationId: firstWorkspaceId, ...fixture }
	)
	await expect(memos).toHaveText(['Live expense', 'Recent expense', 'Older expense'])
	await page.reload()
	await expect(memos).toHaveText(['Live expense', 'Recent expense', 'Older expense'])
})

test('transaction form shows the no-account message after its data loads', async ({ page }) => {
	await page.goto('/expenses/new')
	const main = page.getByRole('main')
	await expect(main.getByText('Add an account before recording a transaction.')).toBeVisible()
	await expect(main.getByRole('button', { name: 'Save transaction' })).toHaveCount(0)
})

const formScenarios = [
	{ kind: 'expense', path: '/expenses/new', link: 'Expenses', memo: 'Form expense' },
	{ kind: 'income', path: '/incomes/new', link: 'Income', memo: 'Form check income' }
] satisfies { kind: 'expense' | 'income'; path: string; link: string; memo: string }[]

for (const scenario of formScenarios) {
	test(`transaction form ${scenario.kind} follows workspace options and saves`, async ({
		page
	}) => {
		await start(page)
		const firstWorkspaceId = await page.getByLabel('Workspace', { exact: true }).inputValue()
		const secondWorkspaceId = await page.evaluate(
			async ({ organizationId, kind }) => {
				const { app, db, userId } = window.workspaceSettingsTest
				const second = await db
					.insert(app.organizations, {
						name: 'Form workspace',
						kind: 'business',
						defaultCurrency: 'USD',
						ownerId: userId
					})
					.wait({ tier: 'global' })
				await db
					.insert(app.organizationMembers, {
						organizationId: second.id,
						userId,
						role: 'owner',
						accountAccessMode: 'all'
					})
					.wait({ tier: 'global' })
				await db
					.insert(app.accounts, {
						organizationId,
						name: 'Personal checking',
						kind: 'bank',
						currency: 'USD'
					})
					.wait({ tier: 'global' })
				await db
					.insert(app.categories, {
						organizationId,
						name: 'Personal category',
						kind,
						isSystem: false
					})
					.wait({ tier: 'global' })
				await db
					.insert(app.accounts, {
						organizationId: second.id,
						name: 'Business checking',
						kind: 'bank',
						currency: 'USD'
					})
					.wait({ tier: 'global' })
				const archivedAccount = await db
					.insert(app.accounts, {
						organizationId: second.id,
						name: 'Archived checking',
						kind: 'bank',
						currency: 'USD'
					})
					.wait({ tier: 'global' })
				await db
					.update(app.accounts, archivedAccount.id, { archivedAt: new Date() })
					.wait({ tier: 'global' })
				await db
					.insert(app.categories, {
						organizationId: second.id,
						name: 'Business category',
						kind,
						isSystem: false
					})
					.wait({ tier: 'global' })
				await db
					.insert(app.categories, {
						organizationId: second.id,
						name: 'Wrong kind category',
						kind: kind === 'expense' ? 'income' : 'expense',
						isSystem: false
					})
					.wait({ tier: 'global' })
				await db
					.insert(app.categories, {
						organizationId: second.id,
						name: 'Archived category',
						kind,
						isSystem: false,
						archivedAt: new Date()
					})
					.wait({ tier: 'global' })
				return second.id
			},
			{ organizationId: firstWorkspaceId, kind: scenario.kind }
		)
		await page
			.getByRole('navigation')
			.getByRole('link', { name: scenario.link, exact: true })
			.click()
		await page
			.getByRole('main')
			.getByRole('link', {
				name: scenario.kind === 'expense' ? 'Add expense' : 'Add income',
				exact: true
			})
			.click()
		await expect(page).toHaveURL(scenario.path)
		const account = page.getByLabel('Account', { exact: true })
		const category = page.getByLabel('Category', { exact: true })
		await expect(account.locator('option')).toHaveText(['Select an account', 'Personal checking'])
		await expect(
			category.getByRole('option', { name: 'Personal category', exact: true })
		).toHaveCount(1)
		await page.getByLabel('Memo', { exact: true }).fill('Draft from previous workspace')
		await expect(page.getByLabel('Check number')).toHaveCount(0)
		await expect(page.getByLabel('Check date')).toHaveCount(0)
		if (scenario.kind === 'income') {
			await page.getByLabel('Payment method').selectOption('check')
			await page.getByLabel('Check number').fill('Previous workspace check')
			await page.getByLabel('Check date').fill('2026-10-12')
		}
		await page.getByLabel('Workspace', { exact: true }).selectOption(secondWorkspaceId)
		await expect(account.locator('option')).toHaveText(['Select an account', 'Business checking'])
		await expect(category.locator('option')).toHaveText(['Select a category', 'Business category'])
		await expect(page.getByLabel('Memo', { exact: true })).toHaveValue('')
		await account.selectOption({ label: 'Business checking' })
		await category.selectOption({ label: 'Business category' })
		await page.getByLabel(/Amount/).fill('42.50')
		await page.getByLabel('Date', { exact: true }).fill('2026-10-13')
		await page.getByLabel('Memo', { exact: true }).fill(scenario.memo)
		if (scenario.kind === 'income') {
			await expect(page.getByLabel('Payment method')).toHaveValue('cash')
			await expect(page.getByLabel('Check number')).toHaveCount(0)
			await page.getByLabel('Payment method').selectOption('check')
			await expect(page.getByLabel('Check number')).toHaveValue('')
			await expect(page.getByLabel('Check date')).toHaveValue('')
			await expect(page.getByLabel('Check number')).toHaveAttribute('required', '')
			await expect(page.getByLabel('Check date')).toHaveAttribute('required', '')
			for (const method of ['cash', 'transfer', 'electronic']) {
				await page.getByLabel('Payment method').selectOption(method)
				await expect(page.getByLabel('Check number')).toHaveCount(0)
				await expect(page.getByLabel('Check date')).toHaveCount(0)
			}
			await page.getByLabel('Payment method').selectOption('check')
			await page.getByRole('button', { name: 'Save transaction', exact: true }).click()
			expect(
				await page
					.getByLabel('Check number')
					.evaluate((element: HTMLInputElement) => element.validity.valueMissing)
			).toBe(true)
			await page.getByLabel('Check number').fill('12345')
			await page.getByRole('button', { name: 'Save transaction', exact: true }).click()
			expect(
				await page
					.getByLabel('Check date')
					.evaluate((element: HTMLInputElement) => element.validity.valueMissing)
			).toBe(true)
			await page.getByLabel('Check date').fill('2026-10-12')
			await page.getByLabel('Check number').fill(' ')
			await page.getByRole('button', { name: 'Save transaction', exact: true }).click()
			await expect(page.getByRole('main').getByRole('alert')).toHaveText(
				'Check the transaction details and try again.'
			)
			await expect(page.getByLabel('Memo', { exact: true })).toHaveValue(scenario.memo)
			await page.getByLabel('Check number').fill('12345')
			await page.getByLabel('Check date').fill('2026-10-12')
		}
		await page.getByRole('button', { name: 'Save transaction', exact: true }).click()
		await expect(page.getByRole('main').getByRole('status')).toHaveText('Transaction saved.')
		const saved = await page.evaluate(
			async ({ organizationId, memo }) => {
				const { app, db } = window.workspaceSettingsTest
				const rows = await db.all(app.transactions.where({ organizationId, memo }), {
					tier: 'remote'
				})
				const row = rows[0]
				return {
					rows,
					checks: row
						? await db.all(app.checkDetails.where({ transactionId: row.id }), { tier: 'remote' })
						: []
				}
			},
			{ organizationId: secondWorkspaceId, memo: scenario.memo }
		)
		expect(saved.rows).toHaveLength(1)
		expect(saved.rows[0]).toMatchObject({
			kind: scenario.kind,
			amountMinor: 4250,
			bookedOn: '2026-10-13'
		})
		if (scenario.kind === 'income') {
			expect(saved.rows[0]?.paymentMethod).toBe('check')
			expect(saved.checks).toHaveLength(1)
			expect(saved.checks[0]).toMatchObject({ checkNumber: '12345', checkDate: '2026-10-12' })
		} else expect(saved.checks).toHaveLength(0)
		await page.getByRole('button', { name: 'Add another transaction' }).click()
		await expect(page.getByLabel('Memo', { exact: true })).toHaveValue('')
		await expect(account.locator('option')).toHaveText(['Select an account', 'Business checking'])
		if (scenario.kind === 'income') {
			await expect(page.getByLabel('Payment method')).toHaveValue('cash')
			await expect(page.getByLabel('Check number')).toHaveCount(0)
			await expect(page.getByLabel('Check date')).toHaveCount(0)
			await page.getByLabel('Payment method').selectOption('check')
			await expect(page.getByLabel('Check number')).toHaveValue('')
			await expect(page.getByLabel('Check date')).toHaveValue('')
		}
	})
}

for (const scenario of formScenarios) {
	test(`default category ${scenario.kind} survives overrides, reset, and workspace switching`, async ({
		page
	}) => {
		await start(page)
		const firstWorkspaceId = await page.getByLabel('Workspace', { exact: true }).inputValue()
		const fixture = await page.evaluate(
			async ({ organizationId, kind }) => {
				const { app, db, userId } = window.workspaceSettingsTest
				const system = await db.one(
					app.categories.where({ organizationId, kind, isSystem: true }),
					{ tier: 'remote' }
				)
				if (!system) throw new Error('System category is missing.')
				const account = await db
					.insert(app.accounts, {
						organizationId,
						name: 'Default checking',
						kind: 'bank',
						currency: 'USD'
					})
					.wait({ tier: 'global' })
				const custom = await db
					.insert(app.categories, {
						organizationId,
						name: 'Custom category',
						kind,
						isSystem: false
					})
					.wait({ tier: 'global' })
				const second = await db
					.insert(app.organizations, {
						name: 'Defaults workspace',
						kind: 'business',
						ownerId: userId,
						defaultCurrency: 'USD'
					})
					.wait({ tier: 'global' })
				await db
					.insert(app.organizationMembers, {
						organizationId: second.id,
						userId,
						role: 'owner',
						accountAccessMode: 'all'
					})
					.wait({ tier: 'global' })
				const secondAccount = await db
					.insert(app.accounts, {
						organizationId: second.id,
						name: 'Second checking',
						kind: 'bank',
						currency: 'USD'
					})
					.wait({ tier: 'global' })
				const secondSystem = await db
					.insert(app.categories, {
						organizationId: second.id,
						name: 'Renamed default',
						kind,
						isSystem: true
					})
					.wait({ tier: 'global' })
				return {
					systemId: system.id,
					accountId: account.id,
					customId: custom.id,
					secondWorkspaceId: second.id,
					secondAccountId: secondAccount.id,
					secondSystemId: secondSystem.id
				}
			},
			{ organizationId: firstWorkspaceId, kind: scenario.kind }
		)
		await page
			.getByRole('navigation')
			.getByRole('link', { name: scenario.link, exact: true })
			.click()
		await page
			.getByRole('main')
			.getByRole('link', {
				name: scenario.kind === 'expense' ? 'Add expense' : 'Add income',
				exact: true
			})
			.click()
		const category = page.getByLabel('Category', { exact: true })
		await expect(category).toHaveValue(fixture.systemId)
		async function save(
			accountId: string,
			memo: string,
			organizationId: string,
			categoryId: string
		) {
			await page.getByLabel('Account', { exact: true }).selectOption(accountId)
			await page.getByLabel(/Amount/).fill('5.00')
			await page.getByLabel('Memo', { exact: true }).fill(memo)
			await page.getByRole('button', { name: 'Save transaction', exact: true }).click()
			await expect(page.getByRole('main').getByRole('status')).toHaveText('Transaction saved.')
			await expect
				.poll(() =>
					page.evaluate(
						async ({ organizationId, memo }) => {
							const { app, db } = window.workspaceSettingsTest
							const rows = await db.all(app.transactions.where({ organizationId, memo }), {
								tier: 'remote'
							})
							return rows.map((row) => ({ categoryId: row.categoryId, kind: row.kind }))
						},
						{ organizationId, memo }
					)
				)
				.toEqual([{ categoryId, kind: scenario.kind }])
			await page.getByRole('button', { name: 'Add another transaction' }).click()
		}
		await save(fixture.accountId, 'Default transaction', firstWorkspaceId, fixture.systemId)
		await expect(category).toHaveValue(fixture.systemId)
		await category.selectOption(fixture.customId)
		await page.evaluate(
			async ({ organizationId, kind }) => {
				const { app, db } = window.workspaceSettingsTest
				await db
					.insert(app.categories, { organizationId, name: 'Live category', kind, isSystem: false })
					.wait({ tier: 'global' })
			},
			{ organizationId: firstWorkspaceId, kind: scenario.kind }
		)
		await expect(category.getByRole('option', { name: 'Live category' })).toHaveCount(1)
		await expect(category).toHaveValue(fixture.customId)
		await save(fixture.accountId, 'Custom transaction', firstWorkspaceId, fixture.customId)
		await expect(category).toHaveValue(fixture.systemId)
		const selector = page.getByLabel('Workspace', { exact: true })
		await selector.selectOption(fixture.secondWorkspaceId)
		await expect(category).toHaveValue(fixture.secondSystemId)
		await save(
			fixture.secondAccountId,
			'Second default transaction',
			fixture.secondWorkspaceId,
			fixture.secondSystemId
		)
		await expect(category).toHaveValue(fixture.secondSystemId)
		await selector.selectOption(firstWorkspaceId)
		await expect(category).toHaveValue(fixture.systemId)
	})
}

test('account archive works offline, retains history, and excludes new-entry options', async ({
	page,
	context
}) => {
	await start(page)
	const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const fixture = await page.evaluate(async (organizationId) => {
		const { app, db } = window.workspaceSettingsTest
		const account = await db
			.insert(app.accounts, {
				organizationId,
				name: 'Archive checking',
				kind: 'bank',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		const category = await db.one(
			app.categories.where({ organizationId, kind: 'expense', isSystem: true }),
			{ tier: 'remote' }
		)
		if (!category) throw new Error('Expense category is missing.')
		const transaction = await db
			.insert(app.transactions, {
				organizationId,
				accountId: account.id,
				categoryId: category.id,
				kind: 'expense',
				amountMinor: 1200,
				currency: 'USD',
				bookedOn: '2026-10-13',
				source: 'manual',
				memo: 'Retained archived history'
			})
			.wait({ tier: 'global' })
		return { accountId: account.id, transactionId: transaction.id }
	}, organizationId)
	await page.getByRole('navigation').getByRole('link', { name: 'Accounts', exact: true }).click()
	const main = page.getByRole('main')
	await expect(
		main.getByRole('button', { name: 'Archive Archive checking', exact: true })
	).toBeEnabled()
	await context.setOffline(true)
	try {
		await main.getByRole('button', { name: 'Archive Archive checking', exact: true }).click()
		await expect(main.getByRole('status')).toHaveText('Account Archive checking archived.')
		await expect(main.getByRole('cell', { name: 'Archive checking', exact: true })).toHaveCount(0)
		await expect(
			page.getByRole('checkbox', { name: 'Show Archive checking', exact: true })
		).toHaveCount(0)
	} finally {
		await context.setOffline(false)
	}
	await expect
		.poll(() =>
			page.evaluate(async (fixture) => {
				const { app, db } = window.workspaceSettingsTest
				const account = await db.one(app.accounts.where({ id: fixture.accountId }), {
					tier: 'remote'
				})
				const transaction = await db.one(app.transactions.where({ id: fixture.transactionId }), {
					tier: 'remote'
				})
				return {
					archived: Boolean(account?.archivedAt),
					retained: transaction?.id === fixture.transactionId
				}
			}, fixture)
		)
		.toEqual({ archived: true, retained: true })
	await page.getByRole('navigation').getByRole('link', { name: 'Expenses', exact: true }).click()
	await expect(
		main.getByRole('cell', { name: 'Retained archived history', exact: true })
	).toBeVisible()
	await main.getByRole('link', { name: 'Add expense', exact: true }).click()
	await expect(main.getByText('Add an account before recording a transaction.')).toBeVisible()
	await page.goto('/accounts')
	await expect(main.getByText('Start with one place you keep money.')).toBeVisible()
})

const archiveScenarios: {
	name: string
	role: NonNullable<OrganizationMember['role']>
	mode: OrganizationMember['accountAccessMode']
	grant?: 'read' | 'write'
	write: boolean
}[] = [
	{ name: 'admin', role: 'admin', mode: 'selected', write: true },
	{ name: 'member with all access', role: 'member', mode: 'all', write: true },
	{
		name: 'member with a write grant',
		role: 'member',
		mode: 'selected',
		grant: 'write',
		write: true
	},
	{
		name: 'member with a read grant',
		role: 'member',
		mode: 'selected',
		grant: 'read',
		write: false
	},
	{ name: 'viewer with a write grant', role: 'viewer', mode: 'all', grant: 'write', write: false }
]

for (const scenario of archiveScenarios) {
	test(`account archive permissions: ${scenario.name}`, async ({ page, browser, baseURL }) => {
		await start(page)
		const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
		const subjectContext = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:5173' })
		try {
			const subject = await subjectContext.newPage()
			await start(subject)
			const subjectId = await subject.evaluate(() => window.workspaceSettingsTest.userId)
			const accountId = await page.evaluate(
				async ({ organizationId, subjectId, scenario }) => {
					const { app, db } = window.workspaceSettingsTest
					const account = await db
						.insert(app.accounts, {
							organizationId,
							name: 'Permission checking',
							kind: 'bank',
							currency: 'USD'
						})
						.wait({ tier: 'global' })
					await db
						.insert(app.organizationMembers, {
							organizationId,
							userId: subjectId,
							role: scenario.role,
							accountAccessMode: scenario.mode
						})
						.wait({ tier: 'global' })
					if (scenario.grant)
						await db
							.insert(app.accountMemberships, {
								organizationId,
								accountId: account.id,
								userId: subjectId,
								access: scenario.grant
							})
							.wait({ tier: 'global' })
					return account.id
				},
				{ organizationId, subjectId, scenario }
			)
			await start(subject)
			await subject
				.getByRole('navigation')
				.getByRole('link', { name: 'Accounts', exact: true })
				.click()
			const selector = subject.getByLabel('Workspace', { exact: true })
			await expect(selector.locator(`option[value="${organizationId}"]`)).toHaveCount(1)
			await selector.selectOption(organizationId)
			const row = subject
				.getByRole('main')
				.getByRole('row')
				.filter({ has: subject.getByRole('cell', { name: 'Permission checking', exact: true }) })
			await expect(row).toBeVisible()
			const archive = row.getByRole('button', { name: 'Archive Permission checking', exact: true })
			if (scenario.write) {
				await expect(archive).toBeEnabled()
				await archive.click()
				await expect(subject.getByRole('main').getByRole('status')).toHaveText(
					'Account Permission checking archived.'
				)
				await expect(row).toHaveCount(0)
			} else {
				await expect(archive).toHaveCount(0)
				const outcome = await subject.evaluate(async (accountId) => {
					const { app, db } = window.workspaceSettingsTest
					try {
						await db
							.update(app.accounts, accountId, { archivedAt: new Date() })
							.wait({ tier: 'global' })
						return 'accepted'
					} catch (error) {
						return error instanceof Error ? error.message : 'unknown-error'
					}
				}, accountId)
				expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
			}
			await expect
				.poll(() =>
					page.evaluate(async (id) => {
						const { app, db } = window.workspaceSettingsTest
						const account = await db.one(app.accounts.where({ id }), { tier: 'remote' })
						return { exists: Boolean(account), archived: Boolean(account?.archivedAt) }
					}, accountId)
				)
				.toEqual({ exists: true, archived: scenario.write })
		} finally {
			await subjectContext.close()
		}
	})
}

for (const role of ['admin', 'member', 'viewer']) {
	test(`${role} has the correct rename access in a shared workspace`, async ({
		page,
		browser,
		baseURL
	}) => {
		await start(page)
		const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
		const otherContext = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:5173' })
		try {
			const subject = await otherContext.newPage()
			await start(subject)
			const ownWorkspaceId = await subject.getByLabel('Workspace', { exact: true }).inputValue()
			const subjectId = await subject.evaluate(() => window.workspaceSettingsTest.userId)
			await page.evaluate(
				async ({ organizationId, subjectId, role }) => {
					const { app, db } = window.workspaceSettingsTest
					if (role !== 'admin' && role !== 'member' && role !== 'viewer')
						throw new Error('Invalid test role.')
					await db
						.update(app.organizations, organizationId, { name: 'Shared workspace' })
						.wait({ tier: 'global' })
					await db
						.insert(app.organizationMembers, {
							organizationId,
							userId: subjectId,
							role,
							accountAccessMode: 'all'
						})
						.wait({ tier: 'global' })
				},
				{ organizationId, subjectId, role }
			)
			// Reopen to obtain the grant and recreate bindings for the new document.
			await start(subject)
			const selector = subject.getByLabel('Workspace', { exact: true })
			await expect(selector.locator(`option[value="${organizationId}"]`)).toHaveCount(1)
			await selector.selectOption(organizationId)
			const name = subject.getByLabel('Workspace name')
			const save = subject.getByRole('button', { name: 'Save', exact: true })
			await expect(name).toHaveValue('Shared workspace')
			if (role === 'admin') {
				await expect(name).toBeEditable()
				await name.fill('Admin renamed workspace')
				await save.click()
				await expect(subject.getByRole('status')).toHaveText('Workspace name saved on this device.')
				await expect(page.getByLabel('Workspace name')).toHaveValue('Admin renamed workspace')
			} else {
				await expect(name).not.toBeEditable()
				await expect(save).toBeDisabled()
				await expect(
					subject.getByText('Only workspace owners and admins can change the name.')
				).toBeVisible()
				const outcome = await subject.evaluate(async (organizationId) => {
					const { app, db } = window.workspaceSettingsTest
					try {
						await db
							.update(app.organizations, organizationId, { name: 'Forbidden rename' })
							.wait({ tier: 'global' })
						return 'accepted'
					} catch (error) {
						return error instanceof Error ? error.message : 'unknown-error'
					}
				}, organizationId)
				expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
				const savedName = await page.evaluate(async (organizationId) => {
					const { app, db } = window.workspaceSettingsTest
					return (await db.one(app.organizations.where({ id: organizationId }), { tier: 'remote' }))
						?.name
				}, organizationId)
				expect(savedName).toBe('Shared workspace')
			}
			await selector.selectOption(ownWorkspaceId)
			await expect(name).toBeEditable()
			await expect(save).toBeEnabled()
			await expect(name).not.toHaveValue('Shared workspace')
		} finally {
			await otherContext.close()
		}
	})
}

test('category page creates both kinds, validates names, resets drafts, and persists after reload', async ({
	page
}) => {
	await start(page)
	const navigation = page.getByRole('navigation')
	await navigation.getByRole('link', { name: 'Categories', exact: true }).click()
	await expect(page).toHaveURL('/settings/categories')
	const main = page.getByRole('main')
	const name = main.getByLabel('Category name', { exact: true })
	const kind = main.getByLabel('Transaction type', { exact: true })
	const add = main.getByRole('button', { name: 'Add category', exact: true })
	await name.fill('   ')
	await add.click()
	await expect(main.getByRole('alert')).toHaveText(
		'Enter a category name and select income or expense.'
	)
	await name.fill('  Travel  ')
	await add.click()
	await expect(main.getByRole('status')).toHaveText('Category Travel saved.')
	await expect(main.getByRole('row', { name: /Travel Expenses/ })).toBeVisible()
	await add.click()
	await name.fill('  Bonus  ')
	await kind.selectOption('income')
	await add.click()
	await expect(main.getByRole('status')).toHaveText('Category Bonus saved.')
	await expect(main.getByRole('row', { name: /Bonus Income/ })).toBeVisible()
	await add.click()
	await name.fill('Unsaved category')
	const secondId = await page.evaluate(async () => {
		const { app, db, userId } = window.workspaceSettingsTest
		const org = await db
			.insert(app.organizations, {
				name: 'Category second workspace',
				kind: 'business',
				defaultCurrency: 'USD',
				ownerId: userId
			})
			.wait({ tier: 'global' })
		await db
			.insert(app.organizationMembers, {
				organizationId: org.id,
				userId,
				role: 'owner',
				accountAccessMode: 'all'
			})
			.wait({ tier: 'global' })
		return org.id
	})
	const selector = page.getByLabel('Workspace', { exact: true })
	const firstId = await selector.inputValue()
	await expect(selector.locator(`option[value="${secondId}"]`)).toHaveCount(1)
	await selector.selectOption(secondId)
	await expect(name).toHaveValue('')
	await expect(main.getByRole('row', { name: /Travel Expenses/ })).toHaveCount(0)
	await expect(main.getByText('No categories yet.')).toBeVisible()
	await name.fill('Second workspace category')
	await add.click()
	await expect(main.getByRole('status')).toHaveText('Category Second workspace category saved.')
	await selector.selectOption(firstId)
	await expect(main.getByRole('row', { name: /Travel Expenses/ })).toBeVisible()
	await expect(main.getByRole('row', { name: /Second workspace category/ })).toHaveCount(0)
	await page.reload()
	await expect(main.getByRole('row', { name: /Travel Expenses/ })).toBeVisible()
	await expect(main.getByRole('row', { name: /Bonus Income/ })).toBeVisible()
})

test('category page counts connections, archives offline, protects system categories, and retains history', async ({
	page,
	context
}) => {
	await start(page)
	const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const fixture = await page.evaluate(async (organizationId) => {
		const { app, db } = window.workspaceSettingsTest
		const category = await db
			.insert(app.categories, {
				organizationId,
				name: 'Counted category',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'global' })
		const account = await db
			.insert(app.accounts, {
				organizationId,
				name: 'Count account',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		const transaction = await db
			.insert(app.transactions, {
				organizationId,
				accountId: account.id,
				categoryId: category.id,
				kind: 'expense',
				amountMinor: 100,
				currency: 'USD',
				bookedOn: '2026-10-13',
				memo: 'Category retained history',
				source: 'manual'
			})
			.wait({ tier: 'global' })
		await db
			.insert(app.tags, { organizationId, name: 'Active connected tag', categoryId: category.id })
			.wait({ tier: 'global' })
		await db
			.insert(app.tags, {
				organizationId,
				name: 'Archived connected tag',
				categoryId: category.id,
				archivedAt: new Date()
			})
			.wait({ tier: 'global' })
		await db.insert(app.tags, { organizationId, name: 'Unconnected tag' }).wait({ tier: 'global' })
		const system = await db.one(
			app.categories.where({ organizationId, isSystem: true, kind: 'expense' })
		)
		if (!system) throw new Error('Missing system category')
		return { categoryId: category.id, transactionId: transaction.id, systemId: system.id }
	}, organizationId)
	await page.getByRole('navigation').getByRole('link', { name: 'Categories', exact: true }).click()
	const main = page.getByRole('main')
	const row = main
		.getByRole('row')
		.filter({ has: page.getByRole('rowheader', { name: 'Counted category', exact: true }) })
	await expect(row.getByRole('cell').nth(1)).toHaveText('1')
	await expect(row.getByRole('cell').nth(2)).toHaveText('2')
	await page.getByRole('checkbox', { name: 'All accounts', exact: true }).uncheck()
	await expect(row.getByRole('cell').nth(1)).toHaveText('1')
	const systemRows = main
		.getByRole('row')
		.filter({ has: page.getByRole('rowheader', { name: 'Uncategorized', exact: true }) })
	await expect(systemRows).toHaveCount(2)
	await expect(systemRows.getByRole('button')).toHaveCount(0)
	const systemOutcome = await page.evaluate(async (id) => {
		const { app, db } = window.workspaceSettingsTest
		try {
			await db.update(app.categories, id, { archivedAt: new Date() }).wait({ tier: 'global' })
			return 'accepted'
		} catch (error) {
			return error instanceof Error ? error.message : 'unknown-error'
		}
	}, fixture.systemId)
	expect(systemOutcome).toMatch(/AuthorizationDenied|permission_denied/)
	await context.setOffline(true)
	try {
		await row.getByRole('button', { name: 'Archive Counted category', exact: true }).click()
		await expect(main.getByRole('status')).toHaveText('Category Counted category archived.')
		await expect(row).toHaveCount(0)
	} finally {
		await context.setOffline(false)
	}
	await expect
		.poll(() =>
			page.evaluate(async ({ categoryId, transactionId }) => {
				const { app, db } = window.workspaceSettingsTest
				const category = await db.one(app.categories.where({ id: categoryId }), { tier: 'remote' })
				const transaction = await db.one(app.transactions.where({ id: transactionId }), {
					tier: 'remote'
				})
				const tags = await db.all(app.tags.where({ categoryId }), { tier: 'remote' })
				return {
					archived: Boolean(category?.archivedAt),
					retained: transaction?.categoryId === categoryId,
					tags: tags.length
				}
			}, fixture)
		)
		.toEqual({ archived: true, retained: true, tags: 2 })
	await page.getByRole('checkbox', { name: 'All accounts', exact: true }).check()
	await page.getByRole('navigation').getByRole('link', { name: 'Expenses', exact: true }).click()
	await expect(
		main.getByRole('cell', { name: 'Category retained history', exact: true })
	).toBeVisible()
	await page.getByRole('link', { name: 'Add expense', exact: true }).click()
	await expect(
		main.getByLabel('Category', { exact: true }).locator(`option[value="${fixture.categoryId}"]`)
	).toHaveCount(0)
})

for (const role of ['admin', 'member', 'viewer']) {
	test(`category page permissions: ${role}`, async ({ page, browser }) => {
		await start(page)
		const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
		const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
		try {
			const subject = await otherContext.newPage()
			await start(subject)
			const subjectId = await subject.evaluate(() => window.workspaceSettingsTest.userId)
			const categoryId = await page.evaluate(
				async ({ organizationId, subjectId, role }) => {
					const { app, db } = window.workspaceSettingsTest
					if (role !== 'admin' && role !== 'member' && role !== 'viewer')
						throw new Error('Invalid role')
					await db
						.insert(app.organizationMembers, {
							organizationId,
							userId: subjectId,
							role,
							accountAccessMode: 'all'
						})
						.wait({ tier: 'global' })
					return (
						await db
							.insert(app.categories, {
								organizationId,
								name: 'Permission category',
								kind: 'expense',
								isSystem: false
							})
							.wait({ tier: 'global' })
					).id
				},
				{ organizationId, subjectId, role }
			)
			await start(subject)
			const selector = subject.getByLabel('Workspace', { exact: true })
			await expect(selector.locator(`option[value="${organizationId}"]`)).toHaveCount(1)
			await selector.selectOption(organizationId)
			await subject
				.getByRole('navigation')
				.getByRole('link', { name: 'Categories', exact: true })
				.click()
			const main = subject.getByRole('main')
			const row = main.getByRole('row').filter({
				has: subject.getByRole('rowheader', { name: 'Permission category', exact: true })
			})
			await expect(row).toBeVisible()
			const add = main.getByRole('button', { name: 'Add category', exact: true })
			if (role === 'viewer') {
				await expect(add).toBeDisabled()
				await expect(main.getByLabel('Category name', { exact: true })).toBeDisabled()
				await expect(row.getByRole('button')).toHaveCount(0)
				const outcomes = await subject.evaluate(
					async ({ organizationId, categoryId }) => {
						const { app, db } = window.workspaceSettingsTest
						const results: string[] = []
						try {
							await db
								.insert(app.categories, {
									organizationId,
									name: 'Forbidden category',
									kind: 'expense',
									isSystem: false
								})
								.wait({ tier: 'global' })
							results.push('accepted')
						} catch (error) {
							results.push(error instanceof Error ? error.message : 'unknown-error')
						}
						try {
							await db
								.update(app.categories, categoryId, { archivedAt: new Date() })
								.wait({ tier: 'global' })
							results.push('accepted')
						} catch (error) {
							results.push(error instanceof Error ? error.message : 'unknown-error')
						}
						return results
					},
					{ organizationId, categoryId }
				)
				for (const outcome of outcomes)
					expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
			} else {
				await main.getByLabel('Category name', { exact: true }).fill(`${role} category`)
				await add.click()
				await expect(main.getByRole('status')).toHaveText(`Category ${role} category saved.`)
				await row.getByRole('button', { name: 'Archive Permission category', exact: true }).click()
				await expect(
					main.getByRole('status').filter({ hasText: 'Permission category archived.' })
				).toBeVisible()
				await expect(row).toHaveCount(0)
			}
			await expect
				.poll(() =>
					page.evaluate(async (id) => {
						const { app, db } = window.workspaceSettingsTest
						return Boolean(
							(await db.one(app.categories.where({ id }), { tier: 'remote' }))?.archivedAt
						)
					}, categoryId)
				)
				.toBe(role !== 'viewer')
		} finally {
			await otherContext.close()
		}
	})
}

test('category page counts only readable transactions for selected account access', async ({
	page,
	browser
}) => {
	await start(page)
	const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
	try {
		const subject = await otherContext.newPage()
		await start(subject)
		const subjectId = await subject.evaluate(() => window.workspaceSettingsTest.userId)
		await page.evaluate(
			async ({ organizationId, subjectId }) => {
				const { app, db } = window.workspaceSettingsTest
				await db
					.insert(app.organizationMembers, {
						organizationId,
						userId: subjectId,
						role: 'viewer',
						accountAccessMode: 'selected'
					})
					.wait({ tier: 'global' })
				const category = await db
					.insert(app.categories, {
						organizationId,
						name: 'Scoped count',
						kind: 'expense',
						isSystem: false
					})
					.wait({ tier: 'global' })
				for (const name of ['Readable count account', 'Private count account']) {
					const account = await db
						.insert(app.accounts, { organizationId, name, kind: 'cash', currency: 'USD' })
						.wait({ tier: 'global' })
					await db
						.insert(app.transactions, {
							organizationId,
							accountId: account.id,
							categoryId: category.id,
							kind: 'expense',
							amountMinor: 100,
							currency: 'USD',
							bookedOn: '2026-10-13',
							source: 'manual'
						})
						.wait({ tier: 'global' })
					if (name === 'Readable count account') {
						await db
							.insert(app.accountMemberships, {
								organizationId,
								userId: subjectId,
								accountId: account.id,
								access: 'read'
							})
							.wait({ tier: 'global' })
					}
				}
			},
			{ organizationId, subjectId }
		)
		await start(subject)
		const selector = subject.getByLabel('Workspace', { exact: true })
		await expect(selector.locator(`option[value="${organizationId}"]`)).toHaveCount(1)
		await selector.selectOption(organizationId)
		await subject
			.getByRole('navigation')
			.getByRole('link', { name: 'Categories', exact: true })
			.click()
		await page
			.getByRole('navigation')
			.getByRole('link', { name: 'Categories', exact: true })
			.click()
		const ownerRow = page
			.getByRole('row')
			.filter({ has: page.getByRole('rowheader', { name: 'Scoped count', exact: true }) })
		const subjectRow = subject
			.getByRole('row')
			.filter({ has: subject.getByRole('rowheader', { name: 'Scoped count', exact: true }) })
		await expect(ownerRow.getByRole('cell').nth(1)).toHaveText('2')
		await expect(subjectRow.getByRole('cell').nth(1)).toHaveText('1')
	} finally {
		await otherContext.close()
	}
})
