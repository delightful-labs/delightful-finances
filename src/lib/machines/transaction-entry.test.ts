import { describe, expect, it, vi } from 'vitest'
import { createActor, getInitialSnapshot, waitFor } from 'xstate'
import type {
	TransactionEntryObservation,
	TransactionEntryReason
} from '#lib/transaction-entry-contract.js'
import {
	createTransactionEntryAvailability,
	selectTransactionEntryAvailability,
	createTransactionEntryFormOptions,
	transactionEntryScope,
	applicableTransactionTags
} from './transaction-entry.js'
import type { AppTransaction } from '#lib/domain/transaction.js'
const binding = {}
const id = '00000000-0000-4000-8000-000000000001'
function facts(): TransactionEntryObservation {
	return {
		tags: [],
		binding,
		identityId: 'user',
		organizationId: id,
		kind: 'expense',
		sessionReady: true,
		loading: false,
		failed: false,
		membership: {
			id: 'member',
			userId: 'user',
			organizationId: id,
			role: 'member',
			accountAccessMode: 'selected',
			profileId: null
		},
		grants: [{ accountId: 'account', access: 'write' }],
		accounts: [
			{
				id: 'account',
				organizationId: id,
				name: 'Wallet',
				kind: 'cash',
				currency: 'USD',
				archivedAt: null
			}
		],
		categories: [
			{
				id: 'category',
				organizationId: id,
				name: 'Food',
				kind: 'expense',
				isSystem: false,
				archivedAt: null
			}
		]
	}
}
function policy(f: TransactionEntryObservation) {
	return selectTransactionEntryAvailability(
		getInitialSnapshot(createTransactionEntryAvailability(binding), { revision: 7, facts: f })
	).readiness
}
const transaction: AppTransaction = {
	organizationId: id,
	kind: 'expense',
	accountId: 'account',
	categoryId: 'category',
	money: { amountMinor: 100, currency: 'USD' },
	bookedOn: '2026-10-18',
	source: { source: 'manual' },
	tags: []
}
const tag = {
	id: 'tag',
	organizationId: id,
	name: 'Salary',
	kind: 'expense',
	categoryId: null,
	archivedAt: null
} satisfies TransactionEntryObservation['tags'][number]

describe('transaction tag name policy', () => {
	it('rejects ambiguous normalized active names but allows reuse of one matching tag', () => {
		const f = { ...facts(), intent: { ...transaction, tags: [' SALARY '] } }
		expect(policy({ ...f, tags: [tag] })).toEqual({ kind: 'ready' })
		expect(policy({ ...f, tags: [tag, { ...tag, id: 'duplicate', name: ' salary ' }] })).toEqual({
			kind: 'blocked',
			reason: 'ambiguousTagName'
		})
	})
	it('excludes other kinds, organizations, archived and untyped tags from new assignments', () => {
		const f = {
			...facts(),
			intent: { ...transaction, tags: ['Salary'] },
			tags: [
				tag,
				{ ...tag, id: 'income', kind: 'income' },
				{ ...tag, id: 'legacy', kind: null },
				{ ...tag, id: 'archived', archivedAt: new Date() },
				{ ...tag, id: 'other', organizationId: 'other' }
			] satisfies TransactionEntryObservation['tags']
		}
		expect(applicableTransactionTags(f)).toEqual([tag])
		expect(policy(f)).toEqual({ kind: 'ready' })
	})
})
describe('transaction entry prerequisites and authorization', () => {
	it.each([
		[{ sessionReady: false }, 'sessionUnavailable'],
		[{ binding: {} }, 'sessionUnavailable'],
		[{ organizationId: null }, 'selectWorkspace'],
		[{ failed: true, loading: true }, 'loadFailed'],
		[{ loading: true }, 'loading'],
		[{ membership: null }, 'readOnly'],
		[{ accounts: [] }, 'noAccounts'],
		[{ grants: [] }, 'readOnly'],
		[{ categories: [] }, 'noCategories'],
		[
			{
				categories: [
					{
						id: 'other',
						organizationId: id,
						name: 'Income',
						kind: 'income',
						isSystem: false,
						archivedAt: null
					}
				]
			},
			'noCategories'
		]
	] satisfies [Partial<TransactionEntryObservation>, TransactionEntryReason][])(
		'classifies %j',
		(patch, reason) => expect(policy({ ...facts(), ...patch })).toEqual({ kind: 'blocked', reason })
	)
	it('distinguishes all-account members from selected read grants and viewers', () => {
		const f = facts()
		const member = f.membership
		if (!member) throw new Error('fixture')
		expect(policy({ ...f, grants: [{ accountId: 'account', access: 'read' }] })).toEqual({
			kind: 'blocked',
			reason: 'readOnly'
		})
		expect(
			policy({ ...f, grants: [], membership: { ...member, accountAccessMode: 'all' } })
		).toEqual({ kind: 'ready' })
		expect(policy({ ...f, membership: { ...member, role: 'viewer' } })).toEqual({
			kind: 'blocked',
			reason: 'readOnly'
		})
		expect(policy({ ...f, membership: { ...member, userId: 'other' } })).toEqual({
			kind: 'blocked',
			reason: 'readOnly'
		})
	})
	it.each([
		{ ...transaction, organizationId: 'other' },
		{ ...transaction, accountId: 'stale' },
		{ ...transaction, categoryId: 'stale' },
		{ ...transaction, money: { amountMinor: 100, currency: 'EUR' } }
	])('rejects stale exact intent', (intent) =>
		expect(policy({ ...facts(), intent })).toEqual({
			kind: 'blocked',
			reason: 'unavailableReference'
		})
	)
	it('rechecks changed grants and references on direct operation without issuing a write', async () => {
		let f = facts()
		const create = vi.fn(async () => undefined)
		const options = createTransactionEntryFormOptions({ binding, observe: () => f, create })
		const input = {
			request: { id: 1, scope: transactionEntryScope(f), scopeRevision: 0, values: transaction },
			observation: { revision: 0, facts: f }
		}
		f = { ...f, grants: [] }
		const actor = createActor(options.operation, { input }).start()
		await waitFor(actor, (s) => s.status === 'done')
		expect(actor.getSnapshot().output).toMatchObject({ outcome: 'denied', reason: 'readOnly' })
		expect(create).not.toHaveBeenCalled()
		actor.stop()
		f = { ...facts(), accounts: [{ ...facts().accounts[0]!, currency: 'EUR' }] }
		const stale = createActor(options.operation, { input }).start()
		await waitFor(stale, (s) => s.status === 'done')
		expect(stale.getSnapshot().output).toMatchObject({
			outcome: 'unavailable',
			reason: 'unavailableReference'
		})
		expect(create).not.toHaveBeenCalled()
		stale.stop()
	})
})
