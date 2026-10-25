import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { schema as s } from 'jazz-tools'
import { createPolicyTestApp, type PolicyTestApp, type TestDb } from 'jazz-tools/testing'

const app = s.defineApp({
	transactions: s.table(
		{
			organizationId: s.uuid(),
			accountId: s.uuid(),
			kind: s.enum('expense', 'income'),
			amountMinor: s.string(),
			currency: s.string(),
			internalTransferId: s.uuid().optional()
		},
		{}
	),
	internalTransfers: s.table(
		{
			organizationId: s.uuid(),
			expenseTransactionId: s.uuid(),
			incomeTransactionId: s.uuid(),
			expenseAccountId: s.uuid(),
			incomeAccountId: s.uuid(),
			amountMinor: s.string(),
			currency: s.string()
		},
		{
			expenseTransaction: s.rel('transactions', 'expenseTransactionId'),
			incomeTransaction: s.rel('transactions', 'incomeTransactionId')
		}
	)
})

const permissions = s.definePermissions(app, ({ policy, allOf }) => {
	const transferEndpointsMatch = (
		transfer: import('jazz-tools/permissions').RowContext<s.RowOf<typeof app.internalTransfers>>
	) =>
		allOf([
			policy.transactions.exists.where({
				id: transfer.expenseTransactionId,
				organizationId: transfer.organizationId,
				accountId: transfer.expenseAccountId,
				kind: 'expense',
				amountMinor: transfer.amountMinor,
				currency: transfer.currency,
				internalTransferId: transfer.id
			}),
			policy.transactions.exists.where({
				id: transfer.incomeTransactionId,
				organizationId: transfer.organizationId,
				accountId: transfer.incomeAccountId,
				kind: 'income',
				amountMinor: transfer.amountMinor,
				currency: transfer.currency,
				internalTransferId: transfer.id
			})
		])
	policy.transactions.allowRead.always()
	policy.transactions.allowInsert.always()
	policy.internalTransfers.allowRead.where(transferEndpointsMatch)
	policy.internalTransfers.allowInsert.where(transferEndpointsMatch)
})

const organizationId = crypto.randomUUID()
const foreignOrganizationId = crypto.randomUUID()
const expenseAccountId = crypto.randomUUID()
const incomeAccountId = crypto.randomUUID()
const expenseTransactionId = crypto.randomUUID()
const incomeTransactionId = crypto.randomUUID()
const transferId = crypto.randomUUID()
const session = {
	user_id: 'internal-transfer-policy-test',
	authMode: 'local-first',
	claims: {}
} satisfies import('jazz-tools/testing').PolicyTestSession
let fixture: PolicyTestApp
let db: TestDb

function transfer(
	overrides: Partial<import('jazz-tools').schema.InsertOf<typeof app.internalTransfers>> = {}
) {
	return {
		organizationId,
		expenseTransactionId,
		incomeTransactionId,
		expenseAccountId,
		incomeAccountId,
		amountMinor: '4500',
		currency: 'USD',
		...overrides
	} satisfies import('jazz-tools').schema.InsertOf<typeof app.internalTransfers>
}

beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
	db = fixture.as(session)
	await fixture.seed((seed) =>
		seed.insert(
			app.transactions,
			{
				organizationId,
				accountId: expenseAccountId,
				kind: 'expense',
				amountMinor: '4500',
				currency: 'USD',
				internalTransferId: transferId
			},
			{ id: expenseTransactionId }
		)
	)
	await fixture.seed((seed) =>
		seed.insert(
			app.transactions,
			{
				organizationId,
				accountId: incomeAccountId,
				kind: 'income',
				amountMinor: '4500',
				currency: 'USD',
				internalTransferId: transferId
			},
			{ id: incomeTransactionId }
		)
	)
}, 30_000)

afterAll(async () => {
	await fixture?.shutdown()
})

describe('positive Check-style transfer endpoint lookups', () => {
	it('accepts a link whose expense and income match the relationship facts', async () => {
		const saved = await db
			.insert(app.internalTransfers, transfer(), { id: transferId })
			.wait({ tier: 'global' })
		expect(saved.expenseTransactionId).toBe(expenseTransactionId)
	})

	it('rejects an endpoint that does not match its transaction facts', async () => {
		await db.expectDenied((writer) =>
			writer.insert(app.internalTransfers, transfer({ organizationId: foreignOrganizationId }))
		)
		await db.expectDenied((writer) =>
			writer.insert(app.internalTransfers, transfer({ expenseAccountId: incomeAccountId }))
		)
		await db.expectDenied((writer) =>
			writer.insert(app.internalTransfers, transfer({ amountMinor: '4501' }))
		)
		await db.expectDenied((writer) =>
			writer.insert(app.internalTransfers, transfer({ currency: 'CAD' }))
		)
	})
})
