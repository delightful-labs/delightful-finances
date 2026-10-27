import { expect, test, type Page } from '@playwright/test'

async function seedAccounts(page: Page) {
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true })
	).toBeEnabled({ timeout: 30_000 })
	return page.evaluate(async () => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client) throw new Error('Test session is not ready.')
		const db = snapshot.client.db
		const [organization] = await db.all(app.organizations)
		if (!organization) throw new Error('Missing organization.')
		const checking = await db
			.insert(app.accounts, {
				organizationId: organization.id,
				name: 'Transfer checking',
				kind: 'bank',
				currency: 'USD'
			})
			.wait({ tier: 'local' })
		const card = await db
			.insert(app.accounts, {
				organizationId: organization.id,
				name: 'Transfer card',
				kind: 'card',
				currency: 'USD'
			})
			.wait({ tier: 'local' })
		const tanzanianAccount = await db
			.insert(app.accounts, {
				organizationId: organization.id,
				name: 'Transfer TZS account',
				kind: 'cash',
				currency: 'TZS'
			})
			.wait({ tier: 'local' })
		return { checkingId: checking.id, cardId: card.id, tanzanianAccountId: tanzanianAccount.id }
	})
}

async function persistedTransfer(page: Page, accountId: string) {
	return page.evaluate(async (accountId) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/jazz-session.js') = await import(
			sessionPath
		)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		const rows = await db.all(app.transactions.where({ accountId }))
		const links = await db.all(app.internalTransfers)
		return {
			rows: rows.map(
				({ id, organizationId, kind, amountMinor, currency, bookedOn, internalTransferId }) => ({
					id,
					organizationId,
					kind,
					amountMinor,
					currency,
					bookedOn,
					internalTransferId
				})
			),
			links: links.map(
				({
					id,
					organizationId,
					expenseTransactionId,
					incomeTransactionId,
					expenseAccountId,
					incomeAccountId,
					expenseAmountMinor,
					expenseCurrency,
					incomeAmountMinor,
					incomeCurrency,
					amountMinor,
					currency
				}) => ({
					id,
					organizationId,
					expenseTransactionId,
					incomeTransactionId,
					expenseAccountId,
					incomeAccountId,
					expenseAmountMinor,
					expenseCurrency,
					incomeAmountMinor,
					incomeCurrency,
					amountMinor,
					currency
				})
			)
		}
	}, accountId)
}

test('creates both sides of a transfer together while offline', async ({ page, context }) => {
	const accounts = await seedAccounts(page)
	await page.goto('/transfers/new')
	await expect(page.getByLabel('Source Account', { exact: true })).toBeVisible()
	await page.getByLabel('Source Account', { exact: true }).selectOption(accounts.checkingId)
	await page.getByLabel('Destination Account', { exact: true }).selectOption(accounts.cardId)
	await page.getByLabel('Amount', { exact: true }).fill('42.17')
	await page.getByLabel('Date', { exact: true }).fill('2026-10-25')
	await context.setOffline(true)
	await page.getByRole('button', { name: 'Save Transfer', exact: true }).click()
	await expect(page.locator('form').getByRole('status')).toHaveText('Transfer saved.')
	await expect
		.poll(() => persistedTransfer(page, accounts.checkingId))
		.toMatchObject({
			rows: [
				expect.objectContaining({
					kind: 'expense',
					amountMinor: 4217,
					currency: 'USD',
					bookedOn: '2026-10-25'
				})
			],
			links: [
				expect.objectContaining({
					expenseAccountId: accounts.checkingId,
					incomeAccountId: accounts.cardId,
					expenseAmountMinor: 4217,
					expenseCurrency: 'USD',
					incomeAmountMinor: 4217,
					incomeCurrency: 'USD'
				})
			]
		})
	const expense = await persistedTransfer(page, accounts.checkingId)
	const income = await persistedTransfer(page, accounts.cardId)
	const transfer = expense.links[0]
	if (!transfer) throw new Error('Missing paired transfer link')
	expect(expense.rows[0]?.internalTransferId).toBe(transfer.id)
	expect(income.rows).toEqual([
		expect.objectContaining({
			id: transfer.incomeTransactionId,
			kind: 'income',
			amountMinor: 4217,
			currency: 'USD',
			bookedOn: '2026-10-25',
			internalTransferId: transfer.id
		})
	])
	expect(transfer.expenseTransactionId).toBe(expense.rows[0]?.id)
})

test('creates cross-currency transfers with separately entered amounts and currency facts', async ({
	page,
	context
}) => {
	const accounts = await seedAccounts(page)
	await page.goto('/transfers/new')
	await page.getByLabel('Source Account', { exact: true }).selectOption(accounts.checkingId)
	await page
		.getByLabel('Destination Account', { exact: true })
		.selectOption(accounts.tanzanianAccountId)
	const expenseAmount = page.getByLabel('Source Amount', { exact: true })
	const incomeAmount = page.getByLabel('Destination Amount', { exact: true })
	await expect(expenseAmount).toBeVisible()
	await expect(incomeAmount).toBeVisible()
	await expenseAmount.fill('42.17')
	await incomeAmount.fill('65000.00')
	await page.getByLabel('Date', { exact: true }).fill('2026-10-25')
	await context.setOffline(true)
	await page.getByRole('button', { name: 'Save Transfer', exact: true }).click()
	await expect(page.locator('form').getByRole('status')).toHaveText('Transfer saved.')
	const expense = await persistedTransfer(page, accounts.checkingId)
	const income = await persistedTransfer(page, accounts.tanzanianAccountId)
	const transfer = expense.links[0]
	if (!transfer) throw new Error('Missing paired transfer link')
	expect(expense.rows).toEqual([
		expect.objectContaining({ kind: 'expense', amountMinor: 4217, currency: 'USD' })
	])
	expect(income.rows).toEqual([
		expect.objectContaining({ kind: 'income', amountMinor: 6500000, currency: 'TZS' })
	])
	expect(transfer).toMatchObject({
		expenseAccountId: accounts.checkingId,
		incomeAccountId: accounts.tanzanianAccountId,
		expenseAmountMinor: 4217,
		expenseCurrency: 'USD',
		incomeAmountMinor: 6500000,
		incomeCurrency: 'TZS'
	})
})
