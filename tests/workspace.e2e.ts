import { expect, test, type Page } from '@playwright/test'

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
			await page.getByLabel('Payment method').selectOption('check')
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
	})
}

for (const role of ['admin', 'member', 'viewer']) {
	test(`${role} has the correct rename access in a shared workspace`, async ({ page, browser }) => {
		await start(page)
		const organizationId = await page.getByLabel('Workspace', { exact: true }).inputValue()
		const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
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
