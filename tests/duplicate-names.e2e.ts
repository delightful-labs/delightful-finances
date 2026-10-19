import { expect, test, type Locator, type Page } from '@playwright/test'
import { openCreationModal } from './helpers/ui.js'

const duplicateMessage = 'An active item with this name already exists. Choose another name.'

async function saveDialog(dialog: Locator, label: string) {
	await dialog.getByRole('button', { name: label, exact: true }).click()
	await expect(dialog.getByRole('status')).toContainText('saved.')
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(dialog).not.toBeVisible()
}

async function createClassification(
	page: Page,
	entity: 'Category' | 'Tag',
	name: string,
	kind: 'expense' | 'income'
) {
	const dialog = await openCreationModal(page, `Add ${entity}`)
	await dialog.getByLabel(`${entity} name`, { exact: true }).fill(name)
	await dialog.getByLabel('Transaction type', { exact: true }).selectOption(kind)
	await saveDialog(dialog, `Add ${entity}`)
}

test('account duplicate names are rejected across account types offline, and archived names can be reused', async ({
	page,
	context
}) => {
	await page.goto('/accounts')
	let dialog = await openCreationModal(page, 'Add Account')
	await dialog.getByLabel('Account name', { exact: true }).fill('Reserve')
	await dialog.getByLabel('Account type', { exact: true }).selectOption('bank')
	await saveDialog(dialog, 'Add Account')
	dialog = await openCreationModal(page, 'Add Account')
	await dialog.getByLabel('Account name', { exact: true }).fill('  reserve  ')
	await dialog.getByLabel('Account type', { exact: true }).selectOption('cash')
	await context.setOffline(true)
	await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
	await expect(dialog.getByRole('alert')).toHaveText(duplicateMessage)
	await expect(dialog.getByLabel('Account name', { exact: true })).toHaveValue('  reserve  ')
	await expect(dialog.getByLabel('Account type', { exact: true })).toHaveValue('cash')
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
	await expect(
		page.getByRole('table', { name: 'Accounts', exact: true }).getByRole('row')
	).toHaveCount(2)
	await page.getByRole('main').getByRole('button', { name: 'Archive Reserve', exact: true }).click()
	await expect(page.getByRole('button', { name: 'Archive Reserve', exact: true })).toHaveCount(0)
	dialog = await openCreationModal(page, 'Add Account')
	await dialog.getByLabel('Account name', { exact: true }).fill('reserve')
	await saveDialog(dialog, 'Add Account')
	await expect(page.getByRole('table', { name: 'Accounts', exact: true })).toContainText('reserve')
	await context.setOffline(false)
	await page.reload()
	await expect(page.getByRole('table', { name: 'Accounts', exact: true })).toContainText('reserve')
})

test('category and tag names are kind-scoped; tag categories filter and duplicate feedback retains selections', async ({
	page
}) => {
	await page.goto('/settings/categories')
	await createClassification(page, 'Category', 'Shared Salary', 'expense')
	await createClassification(page, 'Category', 'Shared Salary', 'income')
	const categoryDialog = await openCreationModal(page, 'Add Category')
	await categoryDialog.getByLabel('Category name', { exact: true }).fill(' SHARED SALARY ')
	await categoryDialog.getByLabel('Transaction type', { exact: true }).selectOption('income')
	await categoryDialog.getByRole('button', { name: 'Add Category', exact: true }).click()
	await expect(categoryDialog.getByRole('alert')).toHaveText(duplicateMessage)
	await expect(categoryDialog.getByLabel('Category name', { exact: true })).toHaveValue(
		' SHARED SALARY '
	)
	await expect(categoryDialog.getByLabel('Transaction type', { exact: true })).toHaveValue('income')
	await categoryDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
	await page.goto('/settings/tags')
	await createClassification(page, 'Tag', 'Shared Salary', 'expense')
	const dialog = await openCreationModal(page, 'Add Tag')
	await dialog.getByLabel('Tag name', { exact: true }).fill('Shared Salary')
	await dialog.getByLabel('Transaction type', { exact: true }).selectOption('income')
	const category = dialog.getByLabel('Category', { exact: true })
	await expect(
		category.locator('option').filter({ hasText: 'Shared Salary (Income)' })
	).toHaveCount(1)
	await expect(
		category.locator('option').filter({ hasText: 'Shared Salary (Expenses)' })
	).toHaveCount(0)
	await category.selectOption({ label: 'Shared Salary (Income)' })
	await dialog.getByLabel('Transaction type', { exact: true }).selectOption('expense')
	await expect(category).toHaveValue('')
	await dialog.getByLabel('Transaction type', { exact: true }).selectOption('income')
	await category.selectOption({ label: 'Shared Salary (Income)' })
	const categoryId = await category.inputValue()
	await saveDialog(dialog, 'Add Tag')
	const repeated = await openCreationModal(page, 'Add Tag')
	await repeated.getByLabel('Tag name', { exact: true }).fill(' shared salary ')
	await repeated.getByLabel('Transaction type', { exact: true }).selectOption('income')
	await repeated.getByLabel('Category', { exact: true }).selectOption(categoryId)
	await repeated.getByRole('button', { name: 'Add Tag', exact: true }).click()
	await expect(repeated.getByRole('alert')).toHaveText(duplicateMessage)
	await expect(repeated.getByLabel('Tag name', { exact: true })).toHaveValue(' shared salary ')
	await expect(repeated.getByLabel('Transaction type', { exact: true })).toHaveValue('income')
	await expect(repeated.getByLabel('Category', { exact: true })).toHaveValue(categoryId)
	await repeated.getByLabel('Tag name', { exact: true }).fill('Bonus')
	await saveDialog(repeated, 'Add Tag')
	const table = page.getByRole('table', { name: 'Tags', exact: true })
	await expect(table.getByRole('rowheader', { name: 'Shared Salary', exact: true })).toHaveCount(2)
	await expect(table.getByRole('row').filter({ hasText: 'Bonus' })).toContainText('Income')
})

test('transaction tag choices respect kind, inline creation saves kind, and legacy history is preserved', async ({
	page
}) => {
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true })
	).toBeEnabled()
	const seed = await page.evaluate(async () => {
		const schemaPath = '/src/lib/schema.ts',
			sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		const [organization] = await db.all(app.organizations)
		if (!organization) throw new Error('Missing organization')
		const organizationId = organization.id
		const account = await db
			.insert(app.accounts, { organizationId, name: 'Ledger', kind: 'bank', currency: 'USD' })
			.wait({ tier: 'local' })
		const category = await db
			.insert(app.categories, {
				organizationId,
				name: 'Expense category',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'local' })
		const expenseTag = await db
			.insert(app.tags, {
				organizationId,
				name: 'Expense only',
				kind: 'expense',
				categoryId: category.id
			})
			.wait({ tier: 'local' })
		await db
			.insert(app.tags, { organizationId, name: 'Income only', kind: 'income' })
			.wait({ tier: 'local' })
		const legacy = await db
			.insert(app.tags, { organizationId, name: 'Legacy history' })
			.wait({ tier: 'local' })
		const transaction = await db
			.insert(app.transactions, {
				organizationId,
				accountId: account.id,
				categoryId: category.id,
				kind: 'expense',
				amountMinor: 100,
				currency: 'USD',
				bookedOn: '2026-10-19',
				source: 'manual',
				memo: 'Original history'
			})
			.wait({ tier: 'local' })
		await db
			.insert(app.transactionTags, {
				organizationId,
				transactionId: transaction.id,
				tagId: legacy.id
			})
			.wait({ tier: 'local' })
		return {
			organizationId,
			categoryId: category.id,
			expenseTagId: expenseTag.id,
			legacyId: legacy.id,
			transactionId: transaction.id
		}
	})
	await page.goto('/settings/tags')
	await expect(page.getByRole('row').filter({ hasText: 'Legacy history' })).toContainText(
		'Type unassigned'
	)
	await page.goto('/expenses')
	await expect(page.getByRole('main').getByText('Legacy history', { exact: false })).toBeVisible()
	for (const kind of ['expense', 'income']) {
		await page.goto(kind === 'expense' ? '/expenses/new' : '/incomes/new')
		const tags = page.getByRole('combobox', { name: 'Tags', exact: true })
		await tags.click()
		await expect(
			page.getByRole('option', {
				name: kind === 'expense' ? 'Expense only' : 'Income only',
				exact: true
			})
		).toBeVisible()
		await expect(
			page.getByRole('option', {
				name: kind === 'expense' ? 'Income only' : 'Expense only',
				exact: true
			})
		).toHaveCount(0)
		await expect(page.getByRole('option', { name: 'Legacy history', exact: true })).toHaveCount(0)
		await page.getByLabel('Amount', { exact: true }).fill('12.00')
		if (kind === 'expense')
			await page.getByLabel('Category', { exact: true }).selectOption(seed.categoryId)
		await tags.fill('Shared inline')
		await tags.press('Enter')
		if (kind === 'expense') {
			await tags.fill('Expense only')
			await tags.press('Enter')
		}
		await page.getByRole('button', { name: 'Save transaction', exact: true }).click()
		await expect(page.getByRole('main').getByRole('status')).toContainText('Transaction saved.')
	}
	const persisted = await page.evaluate(async (seed) => {
		const schemaPath = '/src/lib/schema.ts',
			sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		return {
			tags: await db.all(app.tags.where({ organizationId: seed.organizationId })),
			links: await db.all(app.transactionTags.where({ organizationId: seed.organizationId })),
			transactions: await db.all(app.transactions.where({ organizationId: seed.organizationId }))
		}
	}, seed)
	expect(
		persisted.tags
			.filter((tag) => tag.name === 'Shared inline')
			.map((tag) => tag.kind)
			.sort()
	).toEqual(['expense', 'income'])
	expect(persisted.links.filter((link) => link.tagId === seed.expenseTagId)).toHaveLength(1)
	expect(persisted.links.filter((link) => link.tagId === seed.legacyId)).toEqual([
		expect.objectContaining({ transactionId: seed.transactionId })
	])
	expect(persisted.tags.find((tag) => tag.id === seed.legacyId)?.kind).toBeNull()
	for (const tag of persisted.tags.filter((tag) => tag.name === 'Shared inline')) {
		const link = persisted.links.find((link) => link.tagId === tag.id)
		expect(link).toBeDefined()
		const transaction = persisted.transactions.find((row) => row.id === link?.transactionId)
		expect(transaction?.kind).toBe(tag.kind)
		expect(tag.categoryId).toBe(transaction?.categoryId)
	}
})
