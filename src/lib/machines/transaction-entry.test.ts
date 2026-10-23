import { creationFixture } from './transaction-create.fixture.js'
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
	sameTransactionEntryScope,
	applicableTransactionTags
} from './transaction-entry.js'
import { createScopedFormMachine } from './scoped-form.js'
import type { AppTransaction } from '#lib/domain/transaction.js'
import type { TransactionDetail } from '#lib/schema.js'
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

describe('transaction edit policy and scope', () => {
	const transactionId = 'transaction-id'
	const detail = {
		id: transactionId,
		organizationId: id,
		accountId: 'account',
		categoryId: 'category',
		amountMinor: 100,
		currency: 'USD',
		kind: 'expense',
		bookedOn: '2026-10-18',
		source: 'manual',
		externalId: null,
		description: null,
		memo: null,
		paymentMethod: null,
		checkDetailsId: null,
		batchId: null,
		$createdBy: { account: 'user', identity: { issuer: 'test', subject: 'user' } },
		$createdAt: new Date(),
		$updatedBy: { account: 'user', identity: { issuer: 'test', subject: 'user' } },
		$updatedAt: new Date(),
		account: null,
		category: null,
		checkDetails: null,
		tags: []
	} satisfies TransactionDetail

	it.each(['expense', 'income'] satisfies TransactionDetail['kind'][])(
		'compares changed and reverted %s drafts using only applicable fields',
		(kind) => {
			const f = {
				...facts(),
				kind,
				transactionId,
				transaction: { ...detail, kind, paymentMethod: kind === 'income' ? 'cash' : null }
			} satisfies TransactionEntryObservation
			const options = createTransactionEntryFormOptions({
				binding,
				observe: () => f,
				save: vi.fn()
			})
			if (options.mode !== 'edit') throw new Error('Expected edit mode')
			const initial = options.initialValues(f)
			const draft = {
				accountId: 'account',
				categoryId: 'category',
				amount: '1.00',
				bookedOn: detail.bookedOn,
				memo: '',
				tags: [],
				...(kind === 'income' ? { paymentMethod: 'cash' } : {})
			}
			expect(options.valuesEqual(draft, initial)).toBe(true)
			expect(options.valuesEqual({ ...draft, description: 'Changed' }, initial)).toBe(false)
			expect(options.valuesEqual({ ...draft, description: '  ' }, initial)).toBe(true)
			expect(options.valuesEqual({ ...draft, amount: '2' }, initial)).toBe(false)
			expect(options.valuesEqual({ ...draft, amount: '1', memo: '  ' }, initial)).toBe(true)
			expect(options.valuesEqual({ ...draft, tags: ['New'] }, initial)).toBe(false)
			expect(options.successContent).toBe('retain')
		}
	)

	it('blocks missing transactions and payment-type changes before writing', async () => {
		expect(policy({ ...facts(), transactionId, transaction: null })).toEqual({
			kind: 'blocked',
			reason: 'unavailableReference'
		})
		const f = {
			...facts(),
			kind: 'income',
			categories: facts().categories.map((category) => ({
				...category,
				kind: 'income' satisfies TransactionDetail['kind']
			})),
			transactionId,
			transaction: { ...detail, kind: 'income', paymentMethod: 'cash' }
		} satisfies TransactionEntryObservation
		const save = vi.fn()
		const options = createTransactionEntryFormOptions({
			binding,
			observe: () => f,
			save
		})
		const values: AppTransaction = {
			...transaction,
			source: { source: 'manual' },
			kind: 'income',
			paymentMethod: 'check',
			checkDetails: { checkNumber: '100', checkDate: detail.bookedOn }
		}
		const actor = createActor(options.operation, {
			input: {
				request: { id: 1, scope: transactionEntryScope(f), scopeRevision: 0, values },
				observation: { revision: 0, facts: f }
			}
		}).start()
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(actor.getSnapshot().output).toMatchObject({
			outcome: 'unavailable',
			reason: 'unavailableReference'
		})
		expect(save).not.toHaveBeenCalled()
		actor.stop()
	})

	it('includes transaction identity in scoped form equality', () => {
		const original = transactionEntryScope({ ...facts(), transactionId })
		expect(
			sameTransactionEntryScope(original, transactionEntryScope({ ...facts(), transactionId }))
		).toBe(true)
		expect(
			sameTransactionEntryScope(
				original,
				transactionEntryScope({ ...facts(), transactionId: 'other' })
			)
		).toBe(false)
	})

	it.each([
		{ ...detail, source: 'simplefin' },
		{ ...detail, organizationId: 'other' },
		{ ...detail, id: 'other' },
		{ ...detail, accountId: 'other' },
		{ ...detail, categoryId: 'other' }
	] satisfies TransactionDetail[])(
		'blocks transaction edits when existing row is unavailable or not writable: %j',
		(row) => {
			expect(policy({ ...facts(), transactionId, transaction: row })).toEqual({
				kind: 'blocked',
				reason: 'unavailableReference'
			})
		}
	)

	it('allows an editable manual transaction within its authorized references', () => {
		expect(policy({ ...facts(), transactionId, transaction: detail })).toEqual({ kind: 'ready' })
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
		const storage = creationFixture()
		const create = storage.beginTransaction
		const options = createTransactionEntryFormOptions({ binding, observe: () => f, db: storage.db })
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

describe('creation navigation', () => {
	it.each(['expense', 'income'] satisfies TransactionDetail['kind'][])(
		'navigates a saved %s to its section, without an intermediate idle success',
		async (kind) => {
			const observation: TransactionEntryObservation = {
				...facts(),
				kind,
				categories: facts().categories.map((category) => ({ ...category, kind }))
			}
			const persisted = Promise.withResolvers<void>()
			const navigation = Promise.withResolvers<void>()
			const storage = creationFixture()
			storage.wait.mockReturnValue(persisted.promise)
			const create = storage.wait
			const navigate = vi.fn((_destination: string, _signal: AbortSignal) => navigation.promise)
			const options = createTransactionEntryFormOptions({
				binding,
				observe: () => observation,
				db: storage.db,
				navigate
			})
			const actor = createActor(createScopedFormMachine(options), { input: observation }).start()
			try {
				actor.send({
					type: 'SUBMIT',
					values: {
						accountId: 'account',
						categoryId: 'category',
						amount: '1.00',
						bookedOn: '2026-10-18',
						tags: [],
						...(kind === 'income' ? { paymentMethod: 'cash' } : {})
					}
				})
				await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
				expect(navigate).not.toHaveBeenCalled()
				persisted.resolve()
				await waitFor(actor, (snapshot) =>
					snapshot.matches({ open: { workflow: { completion: 'navigating' } } })
				)
				expect(navigate).toHaveBeenCalledExactlyOnceWith(
					`${kind === 'income' ? '/income' : '/expenses'}?workspace=${id}`,
					expect.any(AbortSignal)
				)
				expect(actor.getSnapshot().context.result).toMatchObject({
					outcome: 'succeeded',
					settlement: 'locallyPersisted'
				})
				navigation.resolve()
				await waitFor(actor, (snapshot) =>
					snapshot.matches({ open: { workflow: { completion: 'completed' } } })
				)
				expect(create).toHaveBeenCalledTimes(1)
			} finally {
				actor.stop()
			}
		}
	)
})

describe('creation persistence composition', () => {
	it('preserves failed persistence output after rollback rather than reporting success', async () => {
		const f = creationFixture()
		f.wait.mockRejectedValue(new Error('Local settlement failed'))
		const observation = f.input().observation.facts
		const options = createTransactionEntryFormOptions({
			binding: f.db,
			db: f.db,
			observe: () => observation
		})
		const actor = createActor(options.operation, { input: f.input() }).start()
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.matches('failed')).toBe(true)
		expect(done.output).toEqual({
			outcome: 'failed',
			code: 'operationFailed',
			settlement: 'unknown'
		})
		expect(f.rollback).toHaveBeenCalledOnce()
	})
	it('retains a transaction acquired during a reentrant shutdown and waits for rollback', async () => {
		const f = creationFixture()
		const observation = f.input().observation.facts
		const cleanup = Promise.withResolvers<boolean>()
		f.rollback.mockReturnValue(cleanup.promise)
		const options = createTransactionEntryFormOptions({
			binding: f.db,
			db: f.db,
			observe: () => observation
		})
		const actor = createActor(options.operation, { input: f.input() })
		f.beginTransaction.mockImplementation(() => {
			actor.send({ type: 'SHUTDOWN' })
			return f.transaction
		})
		actor.start()
		await vi.waitFor(() => expect(f.rollback).toHaveBeenCalledOnce())
		expect(actor.getSnapshot().status).toBe('active')
		expect(f.insert).not.toHaveBeenCalled()
		cleanup.resolve(true)
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'closed', settlement: 'rejected' })
	})
	it('invalidates the original scope while retaining the pending transaction read', async () => {
		const f = creationFixture()
		let observation = f.input().observation.facts
		const read = Promise.withResolvers<[]>()
		f.all.mockReturnValue(read.promise)
		const options = createTransactionEntryFormOptions({
			binding: f.db,
			db: f.db,
			observe: () => observation
		})
		const actor = createActor(options.operation, {
			input: f.input({ ...f.input().request.values, tags: ['Garden'] })
		}).start()
		await vi.waitFor(() => expect(f.all).toHaveBeenCalledOnce())
		observation = { ...observation, organizationId: 'other' }
		actor.send({ type: 'OBSERVE', observation: { revision: 1, facts: observation } })
		expect(actor.getSnapshot().matches({ writing: 'invalidated' })).toBe(true)
		expect(f.rollback).not.toHaveBeenCalled()
		read.resolve([])
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'scopeChanged', settlement: 'rejected' })
		expect(f.insert).not.toHaveBeenCalled()
	})
	it.each(['CANCEL', 'INVALIDATE', 'SHUTDOWN'] satisfies ('CANCEL' | 'INVALIDATE' | 'SHUTDOWN')[])(
		'preserves local settlement when %s races a committed creation',
		async (type) => {
			const f = creationFixture()
			const observation = f.input().observation.facts
			const persisted = Promise.withResolvers<void>()
			f.wait.mockReturnValue(persisted.promise)
			const options = createTransactionEntryFormOptions({
				binding: f.db,
				db: f.db,
				observe: () => observation
			})
			const actor = createActor(options.operation, { input: f.input() }).start()
			await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce())
			actor.send({ type })
			expect(actor.getSnapshot().status).toBe('active')
			persisted.resolve()
			const done = await waitFor(actor, (s) => s.status === 'done')
			expect(done.output).toEqual({
				outcome:
					type === 'CANCEL' ? 'cancelled' : type === 'INVALIDATE' ? 'scopeChanged' : 'closed',
				settlement: 'locallyPersisted'
			})
			expect(f.rollback).not.toHaveBeenCalled()
		}
	)
})
