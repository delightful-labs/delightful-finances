import { expect, it } from 'vitest'
import { transactionTransferFacts } from './transaction-transfer-observation.js'
import type { InternalTransferCandidate } from '../../domain/internal-transfer.js'
import type { InternalTransfer } from '../../schema.js'

function fixture() {
	const organizationId = crypto.randomUUID(),
		transferId = crypto.randomUUID()
	const expense: InternalTransferCandidate = {
		id: crypto.randomUUID(),
		organizationId,
		accountId: crypto.randomUUID(),
		kind: 'expense',
		amountMinor: 123,
		currency: 'USD',
		bookedOn: '2026-11-09',
		internalTransferId: transferId
	}
	const income: InternalTransferCandidate = {
		...expense,
		id: crypto.randomUUID(),
		accountId: crypto.randomUUID(),
		kind: 'income'
	}
	const link: InternalTransfer = {
		id: transferId,
		organizationId,
		expenseTransactionId: expense.id,
		incomeTransactionId: income.id,
		expenseAccountId: expense.accountId,
		incomeAccountId: income.accountId,
		expenseAmountMinor: 123,
		incomeAmountMinor: 123,
		expenseCurrency: 'USD',
		incomeCurrency: 'USD',
		amountMinor: 123,
		currency: 'USD'
	}
	const scope = {
		identityId: crypto.randomUUID(),
		organizationId,
		binding: {},
		kind: expense.kind,
		transactionId: expense.id
	}
	const observe = (
		links: readonly InternalTransfer[],
		rows: readonly InternalTransferCandidate[],
		loading = false,
		source = expense
	) =>
		transactionTransferFacts({
			observation: { ...scope, transaction: source },
			links,
			transactions: rows,
			scopeGeneration: 7,
			searchEnabled: false,
			loading,
			failed: false
		})
	return { expense, income, link, scope, observe }
}
it('resolves effective and partially settled links without losing scope correlation', () => {
	const f = fixture()
	const effective = f.observe([f.link], [f.expense, f.income])
	expect(effective).toMatchObject({
		scope: f.scope,
		scopeGeneration: 7,
		linked: true,
		linkedTransfer: f.link,
		pendingUnlink: false,
		conflicted: false
	})
	expect(effective.rows).toEqual([f.income])
	const pending = f.observe([f.link], [{ ...f.income, internalTransferId: null }], false, {
		...f.expense,
		internalTransferId: null
	})
	expect(pending).toMatchObject({ linked: true, pendingUnlink: true, conflicted: false })
})
it('marks settled orphan markers as conflicts and excludes foreign-workspace rows', () => {
	const f = fixture()
	expect(f.observe([], [f.expense, f.income], true).conflicted).toBe(false)
	expect(f.observe([], [f.expense, f.income]).conflicted).toBe(true)
	const foreign = crypto.randomUUID()
	const observed = f.observe(
		[{ ...f.link, organizationId: foreign }],
		[{ ...f.income, organizationId: foreign }]
	)
	expect(observed).toMatchObject({
		linked: false,
		conflicted: true,
		rows: [],
		linkedTransactionIds: []
	})
})
