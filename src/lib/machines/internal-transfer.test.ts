import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { PersistedWriteRejectedError, Transaction } from 'jazz-tools'
import {
	app,
	type InternalTransfer,
	type OrganizationMember,
	type TransactionRow
} from '#lib/schema.js'
import { internalTransferLinkMachine, internalTransferUnlinkMachine } from './internal-transfer.js'

const organizationId = '11111111-1111-4111-8111-111111111111'
const identityId = '22222222-2222-4222-8222-222222222222'
const expenseId = '33333333-3333-4333-8333-333333333333'
const incomeId = '44444444-4444-4444-8444-444444444444'
const expenseAccountId = '55555555-5555-4555-8555-555555555555'
const incomeAccountId = '66666666-6666-4666-8666-666666666666'
const transferId = '77777777-7777-4777-8777-777777777777'

function transaction(
	id: string,
	kind: 'expense' | 'income',
	accountId: string,
	overrides: Partial<TransactionRow> = {}
): TransactionRow {
	return {
		id,
		organizationId,
		accountId,
		categoryId: '88888888-8888-4888-8888-888888888888',
		kind,
		amountMinor: 4500,
		currency: 'USD',
		bookedOn: '2026-10-23',
		description: null,
		memo: null,
		paymentMethod: null,
		checkId: null,
		checkDetailsId: null,
		internalTransferId: null,
		source: 'manual',
		externalId: null,
		batchId: null,
		...overrides
	}
}

const expense = transaction(expenseId, 'expense', expenseAccountId)
const income = transaction(incomeId, 'income', incomeAccountId)
const membership: OrganizationMember = {
	id: '99999999-9999-4999-8999-999999999999',
	organizationId,
	userId: identityId,
	profileId: null,
	role: 'owner',
	accountAccessMode: 'all'
}

const actors: ReturnType<typeof createActor>[] = []
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
	vi.restoreAllMocks()
})

function fixture(
	options: { expense?: TransactionRow | null; income?: TransactionRow | null } = {}
) {
	const tx = new Transaction('exclusive', () => {
		throw new Error('Fixture must not open a Jazz runtime')
	})
	const one = vi
		.spyOn(tx, 'one')
		.mockResolvedValueOnce(options.expense === undefined ? expense : options.expense)
		.mockResolvedValueOnce(options.income === undefined ? income : options.income)
		.mockResolvedValueOnce(membership)
	const transfer: InternalTransfer = {
		id: transferId,
		organizationId,
		expenseTransactionId: expenseId,
		incomeTransactionId: incomeId,
		expenseAccountId,
		incomeAccountId,
		amountMinor: 4500,
		currency: 'USD'
	}
	const all = vi.spyOn(tx, 'all').mockResolvedValueOnce([])
	for (let index = 0; index < 4; index += 1) all.mockResolvedValueOnce([])
	const insert = vi.spyOn(tx, 'insert').mockReturnValue(transfer)
	const update = vi.spyOn(tx, 'update').mockImplementation(vi.fn())
	const remove = vi.spyOn(tx, 'delete').mockImplementation(vi.fn())
	vi.spyOn(crypto, 'randomUUID').mockReturnValue(transferId)
	const rollback = vi.spyOn(tx, 'rollback').mockResolvedValue(true)
	const wait = vi.fn(async () => {})
	const commit = vi.fn(() => ({ wait }))
	const beginExclusiveTransaction = vi.fn(() => ({
		one: tx.one.bind(tx),
		all: tx.all.bind(tx),
		insert: tx.insert.bind(tx),
		update: tx.update.bind(tx),
		delete: tx.delete.bind(tx),
		commit,
		rollback: tx.rollback.bind(tx)
	}))
	const db = { beginExclusiveTransaction }
	const actor = () => {
		const instance = createActor(internalTransferLinkMachine, {
			input: {
				db,
				identityId,
				organizationId,
				expenseTransactionId: expenseId,
				incomeTransactionId: incomeId
			}
		})
		actors.push(instance)
		return instance.start()
	}
	const unlinkActor = (request: Partial<{ transferId: string; organizationId: string }> = {}) => {
		const instance = createActor(internalTransferUnlinkMachine, {
			input: {
				db,
				identityId,
				organizationId,
				transferId,
				...request
			}
		})
		actors.push(instance)
		return instance.start()
	}
	return {
		tx,
		one,
		all,
		insert,
		update,
		remove,
		rollback,
		wait,
		commit,
		beginExclusiveTransaction,
		actor,
		unlinkActor
	}
}

describe('internal transfer link machine', () => {
	it('links compatible existing rows in one exclusive transaction and waits for authority acceptance', async () => {
		const f = fixture()
		const actor = f.actor()
		const done = await waitFor(actor, (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({
			outcome: 'succeeded',
			transferId,
			settlement: 'authoritativelyAccepted'
		})
		expect(f.beginExclusiveTransaction).toHaveBeenCalledOnce()
		expect(f.one).toHaveBeenCalledTimes(3)
		expect(f.all).toHaveBeenCalledTimes(5)
		expect(f.insert).toHaveBeenCalledWith(
			app.internalTransfers,
			expect.objectContaining({
				organizationId,
				expenseTransactionId: expenseId,
				incomeTransactionId: incomeId,
				expenseAccountId,
				incomeAccountId,
				amountMinor: 4500,
				currency: 'USD'
			}),
			{ id: transferId }
		)
		expect(f.update).toHaveBeenCalledWith(app.transactions, expenseId, {
			internalTransferId: transferId
		})
		expect(f.update).toHaveBeenCalledWith(app.transactions, incomeId, {
			internalTransferId: transferId
		})
		expect(f.commit).toHaveBeenCalledOnce()
		expect(f.wait).toHaveBeenCalledOnce()
		expect(f.rollback).not.toHaveBeenCalled()
	})

	it('does not stage a relationship for a mismatched amount', async () => {
		const f = fixture({
			income: transaction(incomeId, 'income', incomeAccountId, { amountMinor: 4501 })
		})
		const done = await waitFor(f.actor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({ outcome: 'incompatible', settlement: 'notStarted' })
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledOnce()
	})

	it('does not stage a relationship when the requested workspace does not match', async () => {
		const f = fixture({
			expense: transaction(expenseId, 'expense', expenseAccountId, { organizationId: 'other' })
		})
		const done = await waitFor(f.actor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({ outcome: 'incompatible', settlement: 'notStarted' })
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledOnce()
	})

	it('rolls back when either endpoint is already linked', async () => {
		const f = fixture()
		f.all.mockReset().mockResolvedValueOnce([])
		f.all.mockResolvedValueOnce([
			{
				id: transferId,
				organizationId,
				expenseTransactionId: expenseId,
				incomeTransactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
				expenseAccountId,
				incomeAccountId,
				amountMinor: 4500,
				currency: 'USD'
			} satisfies InternalTransfer
		])
		f.all.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
		const done = await waitFor(f.actor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({ outcome: 'alreadyLinked', settlement: 'notStarted' })
		expect(f.insert).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledOnce()
	})

	it('reports denied when the authority rejects the exclusive transaction', async () => {
		const f = fixture()
		f.wait.mockRejectedValue(Object.create(PersistedWriteRejectedError.prototype))
		const done = await waitFor(f.actor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toMatchObject({
			outcome: 'denied',
			settlement: 'authoritativelyRejected'
		})
		expect(f.rollback).not.toHaveBeenCalled()
	})

	it('reports unresolved settlement failures without attempting to undo an issued commit', async () => {
		const f = fixture()
		const error = new Error('authority unavailable')
		f.wait.mockRejectedValue(error)
		const done = await waitFor(f.actor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({ outcome: 'unavailable', settlement: 'unresolved', error })
		expect(f.rollback).not.toHaveBeenCalled()
	})

	it('rolls back after cancellation while reading and reports cancellation only after cleanup', async () => {
		const f = fixture()
		const pending = Promise.withResolvers<TransactionRow | null>()
		f.one
			.mockReset()
			.mockReturnValueOnce(pending.promise)
			.mockResolvedValueOnce(income)
			.mockResolvedValueOnce(membership)
		const actor = f.actor()
		await vi.waitFor(() =>
			expect(actor.getSnapshot().matches({ running: { work: 'reading' } })).toBe(true)
		)
		actor.send({ type: 'CANCEL' })
		expect(f.rollback).not.toHaveBeenCalled()
		pending.resolve(expense)
		const done = await waitFor(actor, (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({ outcome: 'cancelled', settlement: 'notStarted' })
		expect(f.rollback).toHaveBeenCalledOnce()
		expect(f.insert).not.toHaveBeenCalled()
	})
})

describe('internal transfer unlink machine', () => {
	function linkedFixture() {
		const f = fixture()
		f.one.mockReset().mockResolvedValueOnce({
			id: transferId,
			organizationId,
			expenseTransactionId: expenseId,
			incomeTransactionId: incomeId,
			expenseAccountId,
			incomeAccountId,
			amountMinor: 4500,
			currency: 'USD'
		} satisfies InternalTransfer)
		f.one.mockResolvedValueOnce(membership)
		f.all.mockReset().mockResolvedValueOnce([
			{ ...expense, internalTransferId: transferId },
			{ ...income, internalTransferId: transferId }
		])
		f.all.mockResolvedValueOnce([])
		return f
	}

	it('clears both endpoint markers and removes the relationship in one accepted transaction', async () => {
		const f = linkedFixture()
		const done = await waitFor(f.unlinkActor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({
			outcome: 'succeeded',
			transferId,
			settlement: 'authoritativelyAccepted'
		})
		expect(f.update).toHaveBeenCalledWith(app.transactions, expenseId, { internalTransferId: null })
		expect(f.update).toHaveBeenCalledWith(app.transactions, incomeId, { internalTransferId: null })
		expect(f.remove).toHaveBeenCalledWith(app.internalTransfers, transferId)
		expect(f.commit).toHaveBeenCalledOnce()
		expect(f.wait).toHaveBeenCalledOnce()
		expect(f.rollback).not.toHaveBeenCalled()
	})

	it('does not stage writes when the user cannot edit both accounts', async () => {
		const f = linkedFixture()
		f.one.mockReset().mockResolvedValueOnce({
			id: transferId,
			organizationId,
			expenseTransactionId: expenseId,
			incomeTransactionId: incomeId,
			expenseAccountId,
			incomeAccountId,
			amountMinor: 4500,
			currency: 'USD'
		} satisfies InternalTransfer)
		f.one.mockResolvedValueOnce({ ...membership, role: 'viewer' })
		const done = await waitFor(f.unlinkActor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({ outcome: 'denied', settlement: 'notStarted' })
		expect(f.update).not.toHaveBeenCalled()
		expect(f.remove).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledOnce()
	})

	it('rejects a relationship whose endpoint facts no longer match', async () => {
		const f = linkedFixture()
		f.all.mockReset().mockResolvedValueOnce([
			{ ...expense, internalTransferId: transferId },
			{ ...income, internalTransferId: transferId, amountMinor: 4501 }
		])
		f.all.mockResolvedValueOnce([])
		const done = await waitFor(f.unlinkActor(), (snapshot) => snapshot.status === 'done')

		expect(done.output).toEqual({ outcome: 'incompatible', settlement: 'notStarted' })
		expect(f.update).not.toHaveBeenCalled()
		expect(f.remove).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledOnce()
	})
})
