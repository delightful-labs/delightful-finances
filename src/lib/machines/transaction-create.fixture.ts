import { afterEach, vi } from 'vitest'
import { Transaction } from 'jazz-tools'
import { createActor, type InputFrom } from 'xstate'
import { createTransactionPersistenceMachine } from './transaction-create-persistence.js'
import { transactionEntryScope } from './transaction-entry.js'
import type { TransactionEntryObservation } from '#lib/transaction-entry-contract.js'
import type { AppTransaction } from '#lib/domain/transaction.js'

export const organizationId = '22222222-2222-4222-8222-222222222222'
export const creationValues: AppTransaction = {
	organizationId,
	accountId: 'account',
	categoryId: '33333333-3333-4333-8333-333333333333',
	kind: 'expense',
	source: { source: 'manual' },
	money: { amountMinor: 100, currency: 'USD' },
	bookedOn: '2026-10-18'
}
export function creationFacts(binding: object): TransactionEntryObservation {
	return {
		identityId: 'user',
		organizationId,
		binding,
		kind: 'expense',
		sessionReady: true,
		loading: false,
		failed: false,
		membership: {
			id: 'member',
			userId: 'user',
			organizationId,
			role: 'owner',
			accountAccessMode: 'all',
			profileId: null
		},
		grants: [],
		tags: [],
		accounts: [
			{
				id: 'account',
				organizationId,
				name: 'Ledger',
				kind: 'cash',
				currency: 'USD',
				archivedAt: null
			}
		],
		categories: [
			{
				id: '33333333-3333-4333-8333-333333333333',
				organizationId,
				name: 'Food',
				kind: 'expense',
				isSystem: false,
				archivedAt: null
			}
		]
	}
}
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.restoreAllMocks()
})
export function creationFixture() {
	const transaction = new Transaction('mergeable', () => {
		throw new Error('Unit fixture must not open a runtime')
	})
	const insert = vi.spyOn(transaction, 'insert').mockImplementation(vi.fn())
	const all = vi.spyOn(transaction, 'all').mockResolvedValue([])
	const rollback = vi.spyOn(transaction, 'rollback').mockResolvedValue(true)
	const wait = vi.fn(async (_options: { tier: 'local' }) => {})
	const commit = vi
		.spyOn(transaction, 'commit')
		.mockImplementation(vi.fn().mockReturnValue({ wait }))
	const beginTransaction = vi.fn(() => transaction)
	const db = { beginTransaction }
	const machine = createTransactionPersistenceMachine(db)
	function input(values = creationValues): InputFrom<typeof machine> {
		const facts = creationFacts(db)
		return {
			request: { id: 1, scopeRevision: 0, scope: transactionEntryScope(facts), values },
			observation: { revision: 0, facts }
		}
	}
	function start(values = creationValues, logic = machine) {
		const actor = createActor(logic, { input: input(values) })
		cleanups.push(() => actor.stop())
		return actor.start()
	}
	return {
		db,
		transaction,
		all,
		insert,
		rollback,
		wait,
		commit,
		beginTransaction,
		machine,
		input,
		start
	}
}
