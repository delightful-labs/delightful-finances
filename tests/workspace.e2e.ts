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
	await expect(main.getByRole('listitem')).toHaveCount(0)
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
	const memos = main.getByRole('listitem').locator('p')
	await expect(memos).toHaveText(['Recent expense', 'Older expense'])
	await expect(main.getByRole('listitem').getByText('$12.34', { exact: true })).toHaveCount(2)
	await page.getByRole('checkbox', { name: 'Show Cash', exact: true }).uncheck()
	await expect(memos).toHaveText(['Older expense'])
	await page.getByRole('checkbox', { name: 'All accounts', exact: true }).check()
	await expect(memos).toHaveText(['Recent expense', 'Older expense'])
	await page.getByRole('checkbox', { name: 'All accounts', exact: true }).uncheck()
	await expect(main.getByText('Turn on an account to see its transactions.')).toBeVisible()
	await expect(main.getByRole('listitem')).toHaveCount(0)
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
	await expect(main.getByText('Retained archived history', { exact: true })).toBeVisible()
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
	await expect(main.getByText('Category retained history', { exact: true })).toBeVisible()
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

test('tag page creates optional categories, rejects blank names, filters archived categories, and persists', async ({
	page
}) => {
	await start(page)
	const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const categoryId = await page.evaluate(async (organizationId) => {
		const { app, db } = window.workspaceSettingsTest
		await db
			.insert(app.categories, {
				organizationId,
				name: 'Archived choice',
				kind: 'expense',
				isSystem: false,
				archivedAt: new Date()
			})
			.wait({ tier: 'global' })
		return (
			await db
				.insert(app.categories, {
					organizationId,
					name: 'Tag category',
					kind: 'expense',
					isSystem: false
				})
				.wait({ tier: 'global' })
		).id
	}, organizationId)
	await page.getByRole('navigation').getByRole('link', { name: 'Tags', exact: true }).click()
	await expect(page).toHaveURL('/settings/tags')
	const main = page.getByRole('main')
	const name = main.getByLabel('Tag name', { exact: true })
	const category = main.getByLabel('Category', { exact: true })
	const add = main.getByRole('button', { name: 'Add tag', exact: true })
	await expect(
		category.getByRole('option', { name: 'Archived choice (Expenses)', exact: true })
	).toHaveCount(0)
	await expect(category).toHaveValue('')
	await name.fill('   ')
	await add.click()
	await expect(main.getByRole('alert')).toHaveText(
		'Enter a tag name and select an available category or no category.'
	)
	await name.fill('  Unassigned tag  ')
	await add.click()
	await expect(main.getByRole('status')).toHaveText('Tag Unassigned tag saved.')
	await expect(main.getByRole('row', { name: /Unassigned tag No category/ })).toBeVisible()
	await add.click()
	await name.fill('  Categorized tag  ')
	await category.selectOption(categoryId)
	await add.click()
	await expect(main.getByRole('status')).toHaveText('Tag Categorized tag saved.')
	await expect(main.getByRole('row', { name: /Categorized tag Tag category/ })).toBeVisible()
	await page.evaluate(async (id) => {
		const { app, db } = window.workspaceSettingsTest
		await db.update(app.categories, id, { archivedAt: new Date() }).wait({ tier: 'global' })
	}, categoryId)
	await expect(main.getByRole('row', { name: /Categorized tag Tag category/ })).toBeVisible()
	await add.click()
	await expect(category.locator(`option[value="${categoryId}"]`)).toHaveCount(0)
	await expect(category).toHaveValue('')
	await page.reload()
	await expect(main.getByRole('row', { name: /Unassigned tag No category/ })).toBeVisible()
	await expect(main.getByRole('row', { name: /Categorized tag Tag category/ })).toBeVisible()
})

test('tag page switches workspace drafts and archives offline without removing category connections', async ({
	page,
	context
}) => {
	await start(page)
	const firstId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const fixture = await page.evaluate(async (organizationId) => {
		const { app, db, userId } = window.workspaceSettingsTest
		const category = await db
			.insert(app.categories, {
				organizationId,
				name: 'Retained tag category',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'global' })
		const tag = await db
			.insert(app.tags, { organizationId, name: 'Archive tag', categoryId: category.id })
			.wait({ tier: 'global' })
		const org = await db
			.insert(app.organizations, {
				name: 'Second tag workspace',
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
		await db
			.insert(app.categories, {
				organizationId: org.id,
				name: 'Second category',
				kind: 'income',
				isSystem: false
			})
			.wait({ tier: 'global' })
		return { secondId: org.id, tagId: tag.id, categoryId: category.id }
	}, firstId)
	await page.getByRole('navigation').getByRole('link', { name: 'Tags', exact: true }).click()
	const main = page.getByRole('main')
	const name = main.getByLabel('Tag name', { exact: true })
	const selector = page.getByLabel('Workspace', { exact: true })
	await name.fill('Unsaved draft')
	await selector.selectOption(fixture.secondId)
	await expect(name).toHaveValue('')
	await expect(main.getByText('No tags yet.', { exact: true })).toBeVisible()
	const category = main.getByLabel('Category', { exact: true })
	await expect(
		category.getByRole('option', { name: 'Retained tag category (Expenses)', exact: true })
	).toHaveCount(0)
	await name.fill('Second tag')
	await main.getByRole('button', { name: 'Add tag', exact: true }).click()
	await expect(main.getByRole('status')).toHaveText('Tag Second tag saved.')
	await selector.selectOption(firstId)
	await expect(main.getByRole('row', { name: /Second tag/ })).toHaveCount(0)
	const row = main
		.getByRole('row')
		.filter({ has: page.getByRole('rowheader', { name: 'Archive tag', exact: true }) })
	await expect(row).toBeVisible()
	await context.setOffline(true)
	try {
		await row.getByRole('button', { name: 'Archive Archive tag', exact: true }).click()
		await expect(main.getByRole('status')).toHaveText('Tag Archive tag archived.')
		await expect(row).toHaveCount(0)
	} finally {
		await context.setOffline(false)
	}
	await expect
		.poll(() =>
			page.evaluate(async ({ tagId, categoryId }) => {
				const { app, db } = window.workspaceSettingsTest
				const tag = await db.one(app.tags.where({ id: tagId }), { tier: 'remote' })
				return {
					archived: Boolean(tag?.archivedAt),
					categoryRetained: tag?.categoryId === categoryId
				}
			}, fixture)
		)
		.toEqual({ archived: true, categoryRetained: true })
	await page.getByRole('navigation').getByRole('link', { name: 'Categories', exact: true }).click()
	const categoryRow = main
		.getByRole('row')
		.filter({ has: page.getByRole('rowheader', { name: 'Retained tag category', exact: true }) })
	await expect(categoryRow.getByRole('cell').nth(2)).toHaveText('1')
})

for (const role of ['admin', 'member', 'viewer']) {
	test(`tag page permissions: ${role}`, async ({ page, browser }) => {
		await start(page)
		const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
		const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
		try {
			const subject = await otherContext.newPage()
			await start(subject)
			const subjectId = await subject.evaluate(() => window.workspaceSettingsTest.userId)
			const tagId = await page.evaluate(
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
							.insert(app.tags, {
								organizationId,
								name: 'Permission tag'
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
			await subject.getByRole('navigation').getByRole('link', { name: 'Tags', exact: true }).click()
			const main = subject.getByRole('main')
			const row = main.getByRole('row').filter({
				has: subject.getByRole('rowheader', { name: 'Permission tag', exact: true })
			})
			await expect(row).toBeVisible()
			const add = main.getByRole('button', { name: 'Add tag', exact: true })
			if (role === 'viewer') {
				await expect(add).toBeDisabled()
				await expect(main.getByLabel('Tag name', { exact: true })).toBeDisabled()
				await expect(row.getByRole('button')).toHaveCount(0)
				const outcomes = await subject.evaluate(
					async ({ organizationId, tagId }) => {
						const { app, db } = window.workspaceSettingsTest
						const results: string[] = []
						try {
							await db
								.insert(app.tags, {
									organizationId,
									name: 'Forbidden tag'
								})
								.wait({ tier: 'global' })
							results.push('accepted')
						} catch (error) {
							results.push(error instanceof Error ? error.message : 'unknown-error')
						}
						try {
							await db.update(app.tags, tagId, { archivedAt: new Date() }).wait({ tier: 'global' })
							results.push('accepted')
						} catch (error) {
							results.push(error instanceof Error ? error.message : 'unknown-error')
						}
						return results
					},
					{ organizationId, tagId }
				)
				for (const outcome of outcomes)
					expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
			} else {
				await main.getByLabel('Tag name', { exact: true }).fill(`${role} tag`)
				await add.click()
				await expect(main.getByRole('status')).toHaveText(`Tag ${role} tag saved.`)
				await row.getByRole('button', { name: 'Archive Permission tag', exact: true }).click()
				await expect(
					main.getByRole('status').filter({ hasText: 'Permission tag archived.' })
				).toBeVisible()
				await expect(row).toHaveCount(0)
			}
			await expect
				.poll(() =>
					page.evaluate(async (id) => {
						const { app, db } = window.workspaceSettingsTest
						return Boolean((await db.one(app.tags.where({ id }), { tier: 'remote' }))?.archivedAt)
					}, tagId)
				)
				.toBe(role !== 'viewer')
		} finally {
			await otherContext.close()
		}
	})
}

for (const kind of ['expense', 'income']) {
	test(`transaction tags ${kind} reuse existing tags, create categorized tags, remove selections, and reset`, async ({
		page
	}) => {
		await start(page)
		const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
		const fixture = await page.evaluate(
			async ({ organizationId, kind }) => {
				const { app, db } = window.workspaceSettingsTest
				if (kind !== 'expense' && kind !== 'income') throw new Error('Invalid kind')
				const account = await db
					.insert(app.accounts, {
						organizationId,
						name: 'Tag entry account',
						kind: 'cash',
						currency: 'USD'
					})
					.wait({ tier: 'global' })
				const category = await db
					.insert(app.categories, {
						organizationId,
						name: 'Selected tag category',
						kind,
						isSystem: false
					})
					.wait({ tier: 'global' })
				const previous = await db
					.insert(app.categories, {
						organizationId,
						name: 'Existing tag category',
						kind,
						isSystem: false
					})
					.wait({ tier: 'global' })
				const tag = await db
					.insert(app.tags, { organizationId, name: 'Existing tag', categoryId: previous.id })
					.wait({ tier: 'global' })
				await db
					.insert(app.tags, { organizationId, name: 'Archived entry tag', archivedAt: new Date() })
					.wait({ tier: 'global' })
				return {
					accountId: account.id,
					categoryId: category.id,
					previousId: previous.id,
					tagId: tag.id
				}
			},
			{ organizationId, kind }
		)
		const navigation = page.getByRole('navigation')
		await navigation
			.getByRole('link', { name: kind === 'expense' ? 'Expenses' : 'Income', exact: true })
			.click()
		await page
			.getByRole('link', { name: kind === 'expense' ? 'Add expense' : 'Add income', exact: true })
			.click()
		const main = page.getByRole('main')
		await main.getByLabel('Account', { exact: true }).selectOption(fixture.accountId)
		await main.getByLabel('Category', { exact: true }).selectOption(fixture.categoryId)
		await main.getByLabel('Amount (USD)', { exact: true }).fill('12.34')
		const tags = main
			.getByRole('combobox', { name: 'Tags', exact: true })
			.or(main.getByRole('textbox', { name: 'Tags', exact: true }))
		await tags.fill('Archived')
		await expect(page.getByRole('option', { name: 'Archived entry tag', exact: true })).toHaveCount(
			0
		)
		await tags.fill('Existing')
		await page.getByRole('option', { name: 'Existing tag', exact: true }).click()
		await tags.fill(' New tag ')
		await tags.press('Enter')
		await tags.fill('Removed tag')
		await tags.press('Enter')
		await main.getByRole('button', { name: 'Remove Removed tag', exact: true }).click()
		await tags.fill('existing tag')
		await tags.press('Enter')
		await expect(
			main.getByText('Tag existing tag is already selected.', { exact: true })
		).toBeVisible()
		await main.getByLabel('Memo', { exact: true }).fill('Tagged entry')
		await main.getByRole('button', { name: 'Save transaction', exact: true }).click()
		await expect(main.getByRole('status')).toHaveText('Transaction saved.')
		await expect
			.poll(() =>
				page.evaluate(
					async ({ organizationId, fixture }) => {
						const { app, db } = window.workspaceSettingsTest
						const transactions = await db.all(
							app.transactions.where({ organizationId, memo: 'Tagged entry' }),
							{ tier: 'remote' }
						)
						const transaction = transactions[0]
						if (!transaction) return null
						const links = await db.all(
							app.transactionTags.where({ transactionId: transaction.id }),
							{ tier: 'remote' }
						)
						const tags = await db.all(app.tags.where({ organizationId }), { tier: 'remote' })
						return {
							transactions: transactions.length,
							links: links.length,
							existingCategory: tags.find((tag) => tag.id === fixture.tagId)?.categoryId,
							newCategory: tags.find((tag) => tag.name === 'New tag')?.categoryId,
							removed: tags.some((tag) => tag.name === 'Removed tag'),
							linkedNames: links
								.map((link) => tags.find((tag) => tag.id === link.tagId)?.name)
								.sort()
						}
					},
					{ organizationId, fixture }
				)
			)
			.toEqual({
				transactions: 1,
				links: 2,
				existingCategory: fixture.previousId,
				newCategory: fixture.categoryId,
				removed: false,
				linkedNames: ['Existing tag', 'New tag']
			})
		await main.getByRole('button', { name: 'Add another transaction', exact: true }).click()
		await expect(main.getByRole('button', { name: /^Remove / })).toHaveCount(0)
		await expect(tags).toHaveValue('')
		await main.getByLabel('Account', { exact: true }).selectOption(fixture.accountId)
		await main.getByLabel('Amount (USD)', { exact: true }).fill('2')
		await main.getByLabel('Memo', { exact: true }).fill('No tags entry')
		await main.getByRole('button', { name: 'Save transaction', exact: true }).click()
		await expect(main.getByRole('status')).toHaveText('Transaction saved.')
		await expect
			.poll(() =>
				page.evaluate(async (organizationId) => {
					const { app, db } = window.workspaceSettingsTest
					const transaction = await db.one(
						app.transactions.where({ organizationId, memo: 'No tags entry' }),
						{ tier: 'remote' }
					)
					if (!transaction) return -1
					return (
						await db.all(app.transactionTags.where({ transactionId: transaction.id }), {
							tier: 'remote'
						})
					).length
				}, organizationId)
			)
			.toBe(0)
	})
}

test('transaction tags reject a tag archived after selection without saving partial data and allow retry', async ({
	page
}) => {
	await start(page)
	const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const tagId = await page.evaluate(async (organizationId) => {
		const { app, db } = window.workspaceSettingsTest
		await db
			.insert(app.accounts, {
				organizationId,
				name: 'Retry tag account',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		return (
			await db
				.insert(app.tags, { organizationId, name: 'Archive while selected' })
				.wait({ tier: 'global' })
		).id
	}, organizationId)
	await page.getByRole('navigation').getByRole('link', { name: 'Expenses', exact: true }).click()
	await page.getByRole('link', { name: 'Add expense', exact: true }).click()
	const main = page.getByRole('main')
	await main.getByLabel('Account', { exact: true }).selectOption({ label: 'Retry tag account' })
	await main.getByLabel('Amount (USD)', { exact: true }).fill('5')
	await main.getByLabel('Memo', { exact: true }).fill('Retry tagged entry')
	const tags = main
		.getByRole('combobox', { name: 'Tags', exact: true })
		.or(main.getByRole('textbox', { name: 'Tags', exact: true }))
	await tags.fill('Archive while')
	await page.getByRole('option', { name: 'Archive while selected', exact: true }).click()
	await page.evaluate(async (id) => {
		const { app, db } = window.workspaceSettingsTest
		await db.update(app.tags, id, { archivedAt: new Date() }).wait({ tier: 'global' })
	}, tagId)
	await main.getByRole('button', { name: 'Save transaction', exact: true }).click()
	await expect(main.getByRole('alert')).toHaveText('Could not save Transaction. Please try again.')
	const partial = await page.evaluate(async (organizationId) => {
		const { app, db } = window.workspaceSettingsTest
		return (
			await db.all(app.transactions.where({ organizationId, memo: 'Retry tagged entry' }), {
				tier: 'remote'
			})
		).length
	}, organizationId)
	expect(partial).toBe(0)
	await expect(main.getByLabel('Amount (USD)', { exact: true })).toHaveValue('5')
	await main.getByRole('button', { name: 'Remove Archive while selected', exact: true }).click()
	await tags.fill('Replacement tag')
	await tags.press('Enter')
	await main.getByRole('button', { name: 'Save transaction', exact: true }).click()
	await expect(main.getByRole('status')).toHaveText('Transaction saved.')
})

test('transaction tags reset on workspace changes and save new categorized tags offline', async ({
	page,
	context
}) => {
	await start(page)
	const firstId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const fixture = await page.evaluate(async (organizationId) => {
		const { app, db, userId } = window.workspaceSettingsTest
		await db
			.insert(app.accounts, {
				organizationId,
				name: 'First tag account',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		await db
			.insert(app.tags, { organizationId, name: 'First workspace tag' })
			.wait({ tier: 'global' })
		const org = await db
			.insert(app.organizations, {
				name: 'Offline tag workspace',
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
		const account = await db
			.insert(app.accounts, {
				organizationId: org.id,
				name: 'Offline tag account',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		const category = await db
			.insert(app.categories, {
				organizationId: org.id,
				name: 'Offline tag category',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'global' })
		return { organizationId: org.id, accountId: account.id, categoryId: category.id }
	}, firstId)
	await page.getByRole('navigation').getByRole('link', { name: 'Expenses', exact: true }).click()
	await page.getByRole('link', { name: 'Add expense', exact: true }).click()
	const main = page.getByRole('main')
	const tags = main
		.getByRole('combobox', { name: 'Tags', exact: true })
		.or(main.getByRole('textbox', { name: 'Tags', exact: true }))
	await tags.fill('First workspace')
	await page.getByRole('option', { name: 'First workspace tag', exact: true }).click()
	await page.getByLabel('Workspace', { exact: true }).selectOption(fixture.organizationId)
	await expect(tags).toHaveValue('')
	await expect(main.getByRole('button', { name: /^Remove / })).toHaveCount(0)
	await tags.fill('First workspace')
	await expect(page.getByRole('option', { name: 'First workspace tag', exact: true })).toHaveCount(
		0
	)
	await main.getByLabel('Account', { exact: true }).selectOption(fixture.accountId)
	await main.getByLabel('Category', { exact: true }).selectOption(fixture.categoryId)
	await main.getByLabel('Amount (USD)', { exact: true }).fill('3')
	await main.getByLabel('Memo', { exact: true }).fill('Offline tag entry')
	await tags.fill('Offline new tag')
	await tags.press('Enter')
	await context.setOffline(true)
	try {
		await main.getByRole('button', { name: 'Save transaction', exact: true }).click()
		await expect(main.getByRole('status')).toHaveText('Transaction saved.')
	} finally {
		await context.setOffline(false)
	}
	await expect
		.poll(() =>
			page.evaluate(async (fixture) => {
				const { app, db } = window.workspaceSettingsTest
				const transaction = await db.one(
					app.transactions.where({
						organizationId: fixture.organizationId,
						memo: 'Offline tag entry'
					}),
					{ tier: 'remote' }
				)
				const tag = await db.one(
					app.tags.where({ organizationId: fixture.organizationId, name: 'Offline new tag' }),
					{ tier: 'remote' }
				)
				if (!transaction || !tag) return null
				const links = await db.all(app.transactionTags.where({ transactionId: transaction.id }), {
					tier: 'remote'
				})
				return { categoryId: tag.categoryId, tags: links.map((link) => link.tagId) }
			}, fixture)
		)
		.toEqual({ categoryId: fixture.categoryId, tags: [expect.any(String)] })
})

test('transaction list groups days, separates currency totals, and displays archived category/tag/account names', async ({
	page
}) => {
	await start(page)
	const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const fixture = await page.evaluate(async (organizationId) => {
		const { app, db } = window.workspaceSettingsTest
		const account = await db
			.insert(app.accounts, {
				organizationId,
				name: 'Daily checking',
				kind: 'bank',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		const euro = await db
			.insert(app.accounts, { organizationId, name: 'Euro account', kind: 'bank', currency: 'EUR' })
			.wait({ tier: 'global' })
		const category = await db
			.insert(app.categories, {
				organizationId,
				name: 'Daily category',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'global' })
		const tag = await db
			.insert(app.tags, { organizationId, name: 'Historical tag', categoryId: category.id })
			.wait({ tier: 'global' })
		const first = await db
			.insert(app.transactions, {
				organizationId,
				accountId: account.id,
				categoryId: category.id,
				kind: 'expense',
				amountMinor: 1000,
				currency: 'USD',
				bookedOn: '2026-03-10',
				memo: 'First daily entry',
				source: 'manual'
			})
			.wait({ tier: 'global' })
		await db
			.insert(app.transactionTags, { organizationId, transactionId: first.id, tagId: tag.id })
			.wait({ tier: 'global' })
		await db
			.insert(app.transactions, {
				organizationId,
				accountId: account.id,
				categoryId: category.id,
				kind: 'expense',
				amountMinor: 250,
				currency: 'USD',
				bookedOn: '2026-03-10',
				source: 'manual'
			})
			.wait({ tier: 'global' })
		await db
			.insert(app.transactions, {
				organizationId,
				accountId: euro.id,
				categoryId: category.id,
				kind: 'expense',
				amountMinor: 300,
				currency: 'EUR',
				bookedOn: '2026-03-10',
				memo: 'Euro daily entry',
				source: 'manual'
			})
			.wait({ tier: 'global' })
		await db
			.insert(app.transactions, {
				organizationId,
				accountId: account.id,
				categoryId: category.id,
				kind: 'expense',
				amountMinor: 50,
				currency: 'USD',
				bookedOn: '2026-03-09',
				memo: 'Previous day',
				source: 'manual'
			})
			.wait({ tier: 'global' })
		await db.update(app.tags, tag.id, { archivedAt: new Date() }).wait({ tier: 'global' })
		await db
			.update(app.categories, category.id, { archivedAt: new Date() })
			.wait({ tier: 'global' })
		return { accountId: account.id, categoryId: category.id, tagId: tag.id }
	}, organizationId)
	await page.getByRole('navigation').getByRole('link', { name: 'Expenses', exact: true }).click()
	const main = page.getByRole('main')
	await expect(main.locator('time')).toHaveText(['Tue, March 10, 2026', 'Mon, March 9, 2026'])
	const day = main.getByRole('region', { name: 'Tue, March 10, 2026', exact: true })
	await expect(day.getByLabel('Daily total: $12.50', { exact: true })).toBeVisible()
	await expect(day.getByLabel('Daily total: €3.00', { exact: true })).toBeVisible()
	await expect(day.getByRole('listitem')).toHaveCount(3)
	const first = day
		.getByRole('listitem')
		.filter({ has: page.getByText('First daily entry', { exact: true }) })
	await expect(first.getByText('Daily category', { exact: true })).toBeVisible()
	await expect(first.getByText('Historical tag', { exact: true })).toBeVisible()
	await expect(first.getByText('Daily checking', { exact: true })).toBeVisible()
	await expect(day.getByRole('listitem').filter({ hasNot: page.locator('p') })).toHaveCount(1)
	await page.getByRole('checkbox', { name: 'Show Euro account', exact: true }).uncheck()
	await expect(day.getByLabel('Daily total: €3.00', { exact: true })).toHaveCount(0)
	await expect(day.getByLabel('Daily total: $12.50', { exact: true })).toBeVisible()
	await expect(day.getByRole('listitem')).toHaveCount(2)
	await page.evaluate(async (fixture) => {
		const { app, db } = window.workspaceSettingsTest
		await db
			.update(app.accounts, fixture.accountId, {
				name: 'Renamed daily account',
				archivedAt: new Date()
			})
			.wait({ tier: 'global' })
		// System categories are protected; this is an ordinary category already archived.
		await db
			.update(app.categories, fixture.categoryId, { name: 'Renamed daily category' })
			.wait({ tier: 'global' })
		await db
			.update(app.tags, fixture.tagId, { name: 'Renamed historical tag' })
			.wait({ tier: 'global' })
	}, fixture)
	await page.getByRole('checkbox', { name: 'All accounts', exact: true }).check()
	await expect(first.getByText('Renamed daily account', { exact: true })).toBeVisible()
	await expect(first.getByText('Renamed daily category', { exact: true })).toBeVisible()
	await expect(first.getByText('Renamed historical tag', { exact: true })).toBeVisible()
	await page.reload()
	await expect(
		main.getByRole('region', { name: 'Tue, March 10, 2026', exact: true }).getByRole('listitem')
	).toHaveCount(3)
	await expect(main.getByText('Renamed historical tag', { exact: true })).toBeVisible()
})

for (const kind of ['expense', 'income']) {
	test(`transaction details ${kind} show related records, authorship, live updates, and reload`, async ({
		page
	}) => {
		await start(page)
		const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
		const fixture = await page.evaluate(
			async ({ organizationId, kind }) => {
				const { app, db, userId } = window.workspaceSettingsTest
				if (kind !== 'expense' && kind !== 'income') throw new Error('Invalid kind')
				const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
				if (!profile) throw new Error('Missing profile')
				await db
					.update(app.profiles, profile.id, { displayName: 'Detail author' })
					.wait({ tier: 'global' })
				const account = await db
					.insert(app.accounts, {
						organizationId,
						name: 'Detail account',
						kind: 'bank',
						currency: 'USD'
					})
					.wait({ tier: 'global' })
				const category = await db
					.insert(app.categories, {
						organizationId,
						name: 'Detail category',
						kind,
						isSystem: false
					})
					.wait({ tier: 'global' })
				const tag = await db
					.insert(app.tags, { organizationId, name: 'Detail tag', categoryId: category.id })
					.wait({ tier: 'global' })
				const transaction = await db
					.insert(app.transactions, {
						organizationId,
						accountId: account.id,
						categoryId: category.id,
						kind,
						amountMinor: 1234,
						currency: 'USD',
						bookedOn: '2026-10-14',
						memo: 'Original detail memo',
						source: 'manual',
						...(kind === 'income' ? { paymentMethod: 'check' } : {})
					})
					.wait({ tier: 'global' })
				await db
					.insert(app.transactionTags, {
						organizationId,
						transactionId: transaction.id,
						tagId: tag.id
					})
					.wait({ tier: 'global' })
				if (kind === 'income')
					await db
						.insert(app.checkDetails, {
							transactionId: transaction.id,
							checkNumber: '12345',
							checkDate: '2026-10-13'
						})
						.wait({ tier: 'global' })
				const metadata = await db.one(
					app.transactions.where({ id: transaction.id }).select('$createdAt', '$createdBy'),
					{ tier: 'remote' }
				)
				if (!metadata) throw new Error('Missing metadata')
				return {
					id: transaction.id,
					createdAt: metadata.$createdAt.toISOString(),
					author: metadata.$createdBy.account
				}
			},
			{ organizationId, kind }
		)
		await page
			.getByRole('navigation')
			.getByRole('link', { name: kind === 'expense' ? 'Expenses' : 'Income', exact: true })
			.click()
		const main = page.getByRole('main')
		const link = main.getByRole('link').filter({ hasText: 'Original detail memo' })
		await expect(link).toHaveAttribute('href', `/transactions/${fixture.id}`)
		await link.focus()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(`/transactions/${fixture.id}`)
		await expect(
			main.getByRole('heading', { name: 'Transaction details', exact: true })
		).toBeVisible()
		for (const text of [
			'Detail account',
			'Detail category',
			'Detail tag',
			'$12.34',
			'Original detail memo'
		])
			await expect(main.getByText(text, { exact: true })).toBeVisible()
		await expect(main.getByText('Detail author', { exact: true })).toHaveCount(2)
		await expect(main.locator(`time[datetime="${fixture.createdAt}"]`)).toHaveCount(2)
		await expect(main.locator('time[datetime="2026-10-14"]')).toHaveText('Oct 14, 2026')
		if (kind === 'income') {
			await expect(main.getByText('Check', { exact: true })).toBeVisible()
			await expect(main.getByText('12345', { exact: true })).toBeVisible()
			await expect(main.locator('time[datetime="2026-10-13"]')).toHaveText('Oct 13, 2026')
		} else await expect(main.getByText('Check number', { exact: true })).toHaveCount(0)
		await page.evaluate(async (id) => {
			const { app, db } = window.workspaceSettingsTest
			await db
				.update(app.transactions, id, { memo: 'Updated detail memo' })
				.wait({ tier: 'global' })
		}, fixture.id)
		await expect(main.getByText('Updated detail memo', { exact: true })).toBeVisible()
		await expect(main.locator(`time[datetime="${fixture.createdAt}"]`)).toHaveCount(1)
		await page.reload()
		await expect(main.getByText('Updated detail memo', { exact: true })).toBeVisible()
		await expect(main.getByText('Detail author', { exact: true })).toHaveCount(2)
		await main
			.getByRole('link', { name: kind === 'expense' ? 'Expenses' : 'Income', exact: true })
			.click()
		await expect(page).toHaveURL(kind === 'expense' ? '/expenses' : '/incomes')
		await expect(main.getByRole('link').filter({ hasText: 'Updated detail memo' })).toBeVisible()
	})
}

test('transaction details hide rows from another active workspace and handle missing IDs', async ({
	page
}) => {
	await start(page)
	const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const fixture = await page.evaluate(async (organizationId) => {
		const { app, db, userId } = window.workspaceSettingsTest
		const account = await db
			.insert(app.accounts, {
				organizationId,
				name: 'Scope account',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		const category = await db.one(
			app.categories.where({ organizationId, kind: 'expense', isSystem: true })
		)
		if (!category) throw new Error('Missing category')
		const transaction = await db
			.insert(app.transactions, {
				organizationId,
				accountId: account.id,
				categoryId: category.id,
				kind: 'expense',
				amountMinor: 100,
				currency: 'USD',
				bookedOn: '2026-10-14',
				memo: 'Scoped detail',
				source: 'manual'
			})
			.wait({ tier: 'global' })
		const org = await db
			.insert(app.organizations, {
				name: 'Other detail workspace',
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
		return { id: transaction.id, otherId: org.id }
	}, organizationId)
	await page.getByRole('navigation').getByRole('link', { name: 'Expenses', exact: true }).click()
	await page.getByRole('main').getByRole('link').filter({ hasText: 'Scoped detail' }).click()
	const main = page.getByRole('main')
	await expect(main.getByText('Scoped detail', { exact: true })).toBeVisible()
	const selector = page.getByLabel('Workspace', { exact: true })
	await selector.selectOption(fixture.otherId)
	await expect(
		main.getByText('This transaction is unavailable in the selected workspace.', { exact: true })
	).toBeVisible()
	await expect(main.getByText('Scoped detail', { exact: true })).toHaveCount(0)
	await selector.selectOption(organizationId)
	await expect(main.getByText('Scoped detail', { exact: true })).toBeVisible()
	await page.goto(`/transactions/${crypto.randomUUID()}`)
	await expect(
		main.getByText('This transaction is unavailable in the selected workspace.', { exact: true })
	).toBeVisible()
})

for (const scenario of [
	{
		name: 'viewer with account read access',
		role: 'viewer',
		mode: 'selected',
		grant: true,
		read: true,
		edit: false
	},
	{
		name: 'viewer without account grants',
		role: 'viewer',
		mode: 'selected',
		grant: false,
		read: false,
		edit: false
	},
	{ name: 'member editor', role: 'member', mode: 'all', grant: false, read: true, edit: true }
]) {
	test(`transaction details permissions: ${scenario.name}`, async ({ page, browser }) => {
		await start(page)
		const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
		const ownerId = await page.evaluate(() => window.workspaceSettingsTest.userId)
		await page.evaluate(async () => {
			const { app, db, userId } = window.workspaceSettingsTest
			const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
			if (!profile) throw new Error('Missing author profile')
			await db
				.update(app.profiles, profile.id, { displayName: 'Shared author' })
				.wait({ tier: 'global' })
		})
		const subjectContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
		try {
			const subject = await subjectContext.newPage()
			await start(subject)
			const subjectId = await subject.evaluate(() => window.workspaceSettingsTest.userId)
			const fixture = await page.evaluate(
				async ({ organizationId, subjectId, scenario }) => {
					const { app, db } = window.workspaceSettingsTest
					if (scenario.role !== 'viewer' && scenario.role !== 'member')
						throw new Error('Invalid role')
					if (scenario.mode !== 'all' && scenario.mode !== 'selected')
						throw new Error('Invalid mode')
					await db
						.insert(app.organizationMembers, {
							organizationId,
							userId: subjectId,
							role: scenario.role,
							accountAccessMode: scenario.mode
						})
						.wait({ tier: 'global' })
					const account = await db
						.insert(app.accounts, {
							organizationId,
							name: 'Shared detail account',
							kind: 'cash',
							currency: 'USD'
						})
						.wait({ tier: 'global' })
					if (scenario.grant)
						await db
							.insert(app.accountMemberships, {
								organizationId,
								userId: subjectId,
								accountId: account.id,
								access: 'read'
							})
							.wait({ tier: 'global' })
					const category = await db.one(
						app.categories.where({ organizationId, kind: 'expense', isSystem: true })
					)
					if (!category) throw new Error('No category')
					const tag = await db
						.insert(app.tags, { organizationId, name: 'Shared detail tag' })
						.wait({ tier: 'global' })
					const transaction = await db
						.insert(app.transactions, {
							organizationId,
							accountId: account.id,
							categoryId: category.id,
							kind: 'expense',
							amountMinor: 100,
							currency: 'USD',
							bookedOn: '2026-10-14',
							memo: 'Shared detail memo',
							source: 'manual'
						})
						.wait({ tier: 'global' })
					await db
						.insert(app.transactionTags, {
							organizationId,
							transactionId: transaction.id,
							tagId: tag.id
						})
						.wait({ tier: 'global' })
					const metadata = await db.one(
						app.transactions.where({ id: transaction.id }).select('$createdAt'),
						{ tier: 'remote' }
					)
					return { id: transaction.id, createdAt: metadata?.$createdAt.toISOString() }
				},
				{ organizationId, subjectId, scenario }
			)
			await start(subject)
			const selector = subject.getByLabel('Workspace', { exact: true })
			await expect(selector.locator(`option[value="${organizationId}"]`)).toHaveCount(1)
			await selector.selectOption(organizationId)
			if (scenario.edit) {
				await subject.evaluate(async (id) => {
					const { app, db, userId } = window.workspaceSettingsTest
					const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
					if (!profile) throw new Error('No editor profile')
					await db
						.update(app.profiles, profile.id, { displayName: 'Detail editor' })
						.wait({ tier: 'global' })
					await db.one(app.transactions.where({ id }), { tier: 'remote' })
					await db
						.update(app.transactions, id, { memo: 'Edited by member' })
						.wait({ tier: 'global' })
				}, fixture.id)
			}
			// Direct navigation exercises permission enforcement independently of visible list links.
			await subject.goto(`/transactions/${fixture.id}`)
			await expect(
				subject
					.getByLabel('Workspace', { exact: true })
					.locator(`option[value="${organizationId}"]`)
			).toHaveCount(1)
			await subject.getByLabel('Workspace', { exact: true }).selectOption(organizationId)
			const main = subject.getByRole('main')
			if (scenario.read) {
				await expect(main.getByText('Shared detail account', { exact: true })).toBeVisible()
				await expect(main.getByText('Shared detail tag', { exact: true })).toBeVisible()
				await expect(main.getByText('Shared author', { exact: true })).toHaveCount(
					scenario.edit ? 1 : 2
				)
				await expect(main.getByText(ownerId, { exact: true })).toHaveCount(0)
				if (scenario.edit) {
					await expect(main.getByText('Detail editor', { exact: true })).toBeVisible()
					await expect(main.getByText('Edited by member', { exact: true })).toBeVisible()
					await expect(main.locator(`time[datetime="${fixture.createdAt}"]`)).toHaveCount(1)
				}
			} else {
				await expect(
					main.getByText('This transaction is unavailable in the selected workspace.', {
						exact: true
					})
				).toBeVisible()
				await expect(main.getByText('Shared detail account', { exact: true })).toHaveCount(0)
				await expect(main.getByText('Shared detail tag', { exact: true })).toHaveCount(0)
				await expect(main.getByText(ownerId, { exact: true })).toHaveCount(0)
			}
		} finally {
			await subjectContext.close()
		}
	})
}

test('overview page exposes income and expense links and preserves the workspace during navigation', async ({
	page
}) => {
	await start(page)
	const workspaceId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	await page.getByRole('complementary').getByRole('link', { name: 'Overview', exact: true }).click()
	await expect(page).toHaveTitle('Overview · Delightful Finance')
	const main = page.getByRole('main')
	await expect(main.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
	await expect(main.getByRole('link', { name: 'Expenses', exact: true })).toHaveAttribute(
		'href',
		'/expenses'
	)
	await expect(main.getByRole('link', { name: 'Income', exact: true })).toHaveAttribute(
		'href',
		'/incomes'
	)
	await main.getByRole('link', { name: 'Expenses', exact: true }).click()
	await expect(page).toHaveURL('/expenses')
	await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue(workspaceId)
	await page.getByRole('complementary').getByRole('link', { name: 'Overview', exact: true }).click()
	await main.getByRole('link', { name: 'Income', exact: true }).click()
	await expect(page).toHaveURL('/incomes')
	await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue(workspaceId)
	await page.getByRole('complementary').getByRole('link', { name: 'Overview', exact: true }).click()
	await expect(page).toHaveURL('/')
	await page.reload()
	await expect(main.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
})

test('profile name saves offline, follows workspace selection, and supplies transaction attribution', async ({
	page
}) => {
	await start(page)
	const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const fixture = await page.evaluate(async (organizationId) => {
		const { app, db, userId } = window.workspaceSettingsTest
		const second = await db
			.insert(app.organizations, {
				name: 'Profile second workspace',
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
		const account = await db
			.insert(app.accounts, {
				organizationId,
				name: 'Profile checking',
				kind: 'bank',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		const category = await db.one(
			app.categories.where({ organizationId, kind: 'expense', isSystem: true })
		)
		if (!category) throw new Error('No category')
		const transaction = await db
			.insert(app.transactions, {
				organizationId,
				accountId: account.id,
				categoryId: category.id,
				kind: 'expense',
				amountMinor: 100,
				currency: 'USD',
				bookedOn: '2026-10-14',
				source: 'manual'
			})
			.wait({ tier: 'global' })
		return { secondId: second.id, transactionId: transaction.id, userId }
	}, organizationId)
	await page
		.getByRole('navigation')
		.getByRole('link', { name: 'Account recovery', exact: true })
		.click()
	await expect(page).toHaveURL('/account')
	const main = page.getByRole('main')
	await expect(main.getByLabel('Display name', { exact: true })).toBeEnabled()
	await page.context().setOffline(true)
	try {
		await main.getByLabel('Display name', { exact: true }).fill('Offline profile owner')
		await main.getByRole('button', { name: 'Save', exact: true }).click()
		await expect(main.getByRole('status')).toHaveText('Display name saved on this device.')
		await expect
			.poll(() =>
				page.evaluate(async () => {
					const { app, db, userId } = window.workspaceSettingsTest
					return (await db.one(app.profiles.where({ userId })))?.displayName
				})
			)
			.toBe('Offline profile owner')
	} finally {
		await page.context().setOffline(false)
	}
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const { app, db, userId } = window.workspaceSettingsTest
				return (await db.one(app.profiles.where({ userId }), { tier: 'remote' }))?.displayName
			})
		)
		.toBe('Offline profile owner')
	const selector = page.getByLabel('Workspace', { exact: true })
	await expect(selector.locator(`option[value="${fixture.secondId}"]`)).toHaveCount(1)
	await selector.selectOption(fixture.secondId)
	await expect(main.getByLabel('Display name', { exact: true })).toHaveValue(
		'Offline profile owner'
	)
	await selector.selectOption(organizationId)
	await page.goto(`/transactions/${fixture.transactionId}`)
	await expect(main.getByText('Offline profile owner', { exact: true })).toHaveCount(2)
	await page
		.getByRole('navigation')
		.getByRole('link', { name: 'Account recovery', exact: true })
		.click()
	await main.getByLabel('Display name', { exact: true }).fill('')
	await main.getByRole('button', { name: 'Save', exact: true }).click()
	await expect(main.getByRole('status')).toHaveText('Display name saved on this device.')
	await page.goto(`/transactions/${fixture.transactionId}`)
	await expect(main.getByText(fixture.userId, { exact: true })).toHaveCount(2)
	await expect(main.getByText('Offline profile owner', { exact: true })).toHaveCount(0)
})

test('profile name edits are owner-only even for members of a shared workspace', async ({
	page,
	browser
}) => {
	await start(page)
	const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
	const owner = await page.evaluate(async () => {
		const { app, db, userId } = window.workspaceSettingsTest
		const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
		if (!profile) throw new Error('Missing profile')
		await db
			.update(app.profiles, profile.id, { displayName: 'Protected profile owner' })
			.wait({ tier: 'global' })
		return { profileId: profile.id, userId }
	})
	const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
	try {
		const subject = await context.newPage()
		await start(subject)
		const subjectId = await subject.evaluate(() => window.workspaceSettingsTest.userId)
		await page.evaluate(
			async ({ organizationId, subjectId }) => {
				const { app, db } = window.workspaceSettingsTest
				await db
					.insert(app.organizationMembers, {
						organizationId,
						userId: subjectId,
						role: 'member',
						accountAccessMode: 'all'
					})
					.wait({ tier: 'global' })
			},
			{ organizationId, subjectId }
		)
		const selector = subject.getByLabel('Workspace', { exact: true })
		await expect(selector.locator(`option[value="${organizationId}"]`)).toHaveCount(1)
		await selector.selectOption(organizationId)
		await subject
			.getByRole('navigation')
			.getByRole('link', { name: 'Account recovery', exact: true })
			.click()
		await expect(subject).toHaveURL('/account')
		await subject.getByLabel('Display name', { exact: true }).fill('Shared workspace member')
		await subject.getByRole('button', { name: 'Save', exact: true }).click()
		await expect(subject.getByRole('main').getByRole('status')).toHaveText(
			'Display name saved on this device.'
		)
		const outcome = await subject.evaluate(async (owner) => {
			const { app, db, userId } = window.workspaceSettingsTest
			const own = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
			if (!own) throw new Error('Missing member profile')
			const visibleOwner = await db.one(app.profiles.where({ id: owner.profileId }), {
				tier: 'remote'
			})
			let edit = 'accepted'
			let transfer = 'accepted'
			try {
				await db
					.upsert(app.profiles, owner.profileId, {
						userId: owner.userId,
						displayName: 'Hijacked name',
						avatarData: new Uint8Array([1]),
						avatarMimeType: 'image/png'
					})
					.wait({ tier: 'global' })
			} catch (error) {
				edit = error instanceof Error ? error.message : 'unknown-error'
			}
			try {
				await db.update(app.profiles, own.id, { userId: owner.userId }).wait({ tier: 'global' })
			} catch (error) {
				transfer = error instanceof Error ? error.message : 'unknown-error'
			}
			const retained = await db.one(app.profiles.where({ id: own.id }), { tier: 'remote' })
			return {
				edit,
				transfer,
				ownerVisible: Boolean(visibleOwner),
				ownName: retained?.displayName,
				ownUserId: retained?.userId
			}
		}, owner)
		expect(outcome.ownerVisible).toBe(true)
		expect(outcome.edit).toMatch(/AuthorizationDenied|permission_denied/)
		expect(outcome.transfer).toMatch(/AuthorizationDenied|permission_denied/)
		expect(outcome.ownName).toBe('Shared workspace member')
		expect(outcome.ownUserId).toBe(subjectId)
		await expect
			.poll(() =>
				page.evaluate(async (id) => {
					const { app, db } = window.workspaceSettingsTest
					const profile = await db.one(app.profiles.where({ id }), { tier: 'remote' })
					return {
						name: profile?.displayName,
						hasAvatar: Boolean(profile?.avatarData),
						mimeType: profile?.avatarMimeType ?? null
					}
				}, owner.profileId)
			)
			.toEqual({ name: 'Protected profile owner', hasAvatar: false, mimeType: null })
	} finally {
		await context.close()
	}
})

for (const role of ['admin', 'member', 'viewer']) {
	test(`shared profile visibility: ${role}, isolation, and membership removal`, async ({
		page,
		browser
	}) => {
		await start(page)
		const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
		const owner = await page.evaluate(async () => {
			const { app, db, userId } = window.workspaceSettingsTest
			const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
			if (!profile) throw new Error('Missing owner profile')
			await db
				.update(app.profiles, profile.id, {
					displayName: 'Shared display profile',
					avatarData: new Uint8Array([1, 2, 3]),
					avatarMimeType: 'image/png'
				})
				.wait({ tier: 'global' })
			const privateWorkspace = await db
				.insert(app.organizations, {
					name: 'Private workspace',
					kind: 'business',
					defaultCurrency: 'USD',
					ownerId: userId
				})
				.wait({ tier: 'global' })
			await db
				.insert(app.organizationMembers, {
					organizationId: privateWorkspace.id,
					userId,
					profileId: profile.id,
					role: 'owner',
					accountAccessMode: 'all'
				})
				.wait({ tier: 'global' })
			return { id: profile.id, userId }
		})
		const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
		try {
			const subject = await context.newPage()
			await start(subject)
			const subjectProfile = await subject.evaluate(async () => {
				const { app, db, userId } = window.workspaceSettingsTest
				const profile = await db.one(app.profiles.where({ userId }), { tier: 'remote' })
				if (!profile) throw new Error('Missing member profile')
				await db
					.update(app.profiles, profile.id, { displayName: 'Shared member' })
					.wait({ tier: 'global' })
				return { id: profile.id, userId }
			})
			const readOwner = () =>
				subject.evaluate(async (id) => {
					const { app, db } = window.workspaceSettingsTest
					const profile = await db.one(app.profiles.where({ id }), { tier: 'remote' })
					return profile
						? {
								name: profile.displayName,
								bytes: Array.from(profile.avatarData ?? []),
								mime: profile.avatarMimeType
							}
						: null
				}, owner.id)
			expect(await readOwner()).toBeNull()
			const membershipId = await page.evaluate(
				async ({ organizationId, subjectProfile, role }) => {
					const { app, db } = window.workspaceSettingsTest
					if (role !== 'admin' && role !== 'member' && role !== 'viewer')
						throw new Error('Invalid role')
					const membership = await db
						.insert(app.organizationMembers, {
							organizationId,
							userId: subjectProfile.userId,
							role,
							accountAccessMode: 'selected'
						})
						.wait({ tier: 'global' })
					return membership.id
				},
				{ organizationId, subjectProfile, role }
			)
			await expect
				.poll(readOwner)
				.toEqual({ name: 'Shared display profile', bytes: [1, 2, 3], mime: 'image/png' })
			// A membership without a profile reference must not expose an unrelated profile.
			expect(
				await page.evaluate(async (id) => {
					const { app, db } = window.workspaceSettingsTest
					return Boolean(await db.one(app.profiles.where({ id }), { tier: 'remote' }))
				}, subjectProfile.id)
			).toBe(false)
			await page.evaluate(
				async ({ membershipId, profileId }) => {
					const { app, db } = window.workspaceSettingsTest
					await db
						.update(app.organizationMembers, membershipId, { profileId })
						.wait({ tier: 'global' })
				},
				{ membershipId, profileId: subjectProfile.id }
			)
			await expect
				.poll(() =>
					page.evaluate(async (id) => {
						const { app, db } = window.workspaceSettingsTest
						return (
							(await db.one(app.profiles.where({ id }), { tier: 'remote' }))?.displayName ?? null
						)
					}, subjectProfile.id)
				)
				.toBe('Shared member')
			expect(
				await subject.evaluate(async (ownerId) => {
					const { app, db } = window.workspaceSettingsTest
					return (await db.all(app.organizations.where({ ownerId }), { tier: 'remote' })).map(
						(organization) => organization.id
					)
				}, owner.userId)
			).toEqual([organizationId])
			await page.evaluate(async (id) => {
				const { app, db } = window.workspaceSettingsTest
				await db.delete(app.organizationMembers, id).wait({ tier: 'global' })
			}, membershipId)
			await expect.poll(readOwner).toBeNull()
			await expect
				.poll(() =>
					page.evaluate(async (id) => {
						const { app, db } = window.workspaceSettingsTest
						return (
							(await db.one(app.profiles.where({ id }), { tier: 'remote' }))?.displayName ?? null
						)
					}, subjectProfile.id)
				)
				.toBeNull()
		} finally {
			await context.close()
		}
	})
}
