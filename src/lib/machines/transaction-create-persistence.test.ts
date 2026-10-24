import { describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise, toPromise, waitFor } from 'xstate'
import { app } from '#lib/schema.js'
import type { AppTransaction } from '#lib/domain/transaction.js'
import { creationFixture, creationValues, organizationId } from './transaction-create.fixture.js'
const organization = { id: organizationId }
function setup() {
	vi.spyOn(crypto, 'randomUUID').mockReturnValue(organizationId)
	return creationFixture()
}
async function createTransaction(db: ReturnType<typeof setup>['db'], values: AppTransaction) {
	const f = creationFixture()
	const actor = createActor(
		f.machine.provide({ actors: { open: fromPromise(async () => db.beginTransaction()) } }),
		{ input: f.input(values) }
	).start()
	return toPromise(actor)
}

describe('createTransaction normalization', () => {
	const input: AppTransaction = {
		kind: 'income',
		source: { source: 'manual' },
		paymentMethod: 'check',
		accountId: 'account',
		organizationId: organization.id,
		categoryId: 'category',
		bookedOn: '2026-10-13',
		money: { amountMinor: 100, currency: 'USD' },
		description: '  Invoice payment  ',
		memo: '  Payment  ',
		checkDetails: { checkNumber: ' 123 ', checkDate: '2026-10-12' }
	}
	it('persists normalized memo and check details', async () => {
		const { db, insert } = setup()
		await createTransaction(db, input)
		expect(insert).toHaveBeenCalledWith(
			app.transactions,
			expect.objectContaining({
				description: 'Invoice payment',
				memo: 'Payment',
				checkDetailsId: organization.id
			}),
			{ id: organization.id }
		)
		expect(insert).toHaveBeenCalledWith(
			app.checkDetails,
			{
				transactionId: organization.id,
				organizationId: organization.id,
				accountId: input.accountId,
				checkNumber: '123',
				checkDate: '2026-10-12'
			},
			{ id: organization.id }
		)
		const tables = insert.mock.calls.map(([table]) => table)
		expect(tables.indexOf(app.checkDetails)).toBeLessThan(tables.indexOf(app.transactions))
	})

	it('omits whitespace-only memos from writes', async () => {
		const { db, insert } = setup()
		await createTransaction(db, { ...input, description: ' ', memo: ' ' })
		const values = insert.mock.calls.find(([table]) => table === app.transactions)?.[1]
		expect(values).not.toHaveProperty('memo')
		expect(values).not.toHaveProperty('description')
	})
	it('rejects invalid transactions without opening a write', async () => {
		const { db } = setup()
		await expect(createTransaction(db, { ...input, bookedOn: 'invalid' })).resolves.toEqual({
			outcome: 'failed',
			code: 'operationFailed',
			settlement: 'notStarted'
		})
		expect(db.beginTransaction).not.toHaveBeenCalled()
	})
})

describe('transaction tag persistence', () => {
	const input: AppTransaction = {
		kind: 'expense',
		source: { source: 'manual' },
		organizationId: organization.id,
		accountId: 'account',
		categoryId: '33333333-3333-4333-8333-333333333333',
		bookedOn: '2026-10-14',
		money: { amountMinor: 100, currency: 'USD' }
	}
	it('creates new tags with the transaction category and links all selected tags atomically', async () => {
		const { db, transaction, insert, wait } = setup()
		vi.spyOn(transaction, 'all').mockResolvedValue([])
		await createTransaction(db, { ...input, tags: [' Garden ', 'Work', 'garden'] })
		expect(db.beginTransaction).toHaveBeenCalledTimes(1)
		expect(insert.mock.calls.filter(([table]) => table === app.tags)).toHaveLength(2)
		expect(insert).toHaveBeenCalledWith(
			app.tags,
			{
				organizationId: organization.id,
				name: 'garden',
				kind: 'expense',
				categoryId: input.categoryId,
				archivedAt: null
			},
			{ id: organization.id }
		)
		expect(insert.mock.calls.filter(([table]) => table === app.transactionTags)).toHaveLength(2)
		expect(insert).toHaveBeenCalledWith(app.transactionTags, {
			organizationId: organization.id,
			transactionId: organization.id,
			tagId: organization.id
		})
		expect(wait).toHaveBeenCalledWith({ tier: 'local' })
	})
	it('reuses existing tags without changing their category', async () => {
		const { db, transaction, insert } = setup()
		vi.spyOn(transaction, 'all').mockResolvedValue([
			{
				id: 'existing',
				organizationId: organization.id,
				name: 'Garden',
				kind: 'expense',
				categoryId: 'original',
				archivedAt: null
			}
		])
		await createTransaction(db, { ...input, tags: ['garden'] })
		expect(insert.mock.calls.filter(([table]) => table === app.tags)).toHaveLength(0)
		expect(insert).toHaveBeenCalledWith(app.transactionTags, {
			organizationId: organization.id,
			transactionId: organization.id,
			tagId: 'existing'
		})
	})
	it('does not read or create tags when none are selected', async () => {
		const { db, transaction, insert } = setup()
		const read = vi.spyOn(transaction, 'all')
		await createTransaction(db, { ...input, tags: [] })
		expect(read).not.toHaveBeenCalled()
		expect(insert).toHaveBeenCalledTimes(1)
	})
	it.each([
		{ kind: 'income', archivedAt: null, organizationId: organization.id },
		{ kind: null, archivedAt: null, organizationId: organization.id },
		{ kind: 'expense', archivedAt: null, organizationId: 'other' }
	])('creates a typed tag instead of reusing an ineligible existing tag: %j', async (patch) => {
		const { db, transaction, insert } = setup()
		vi.spyOn(transaction, 'all').mockResolvedValue([
			{ id: 'old-tag', name: 'Garden', categoryId: null, ...patch }
		])
		await createTransaction(db, { ...input, tags: ['Garden'] })
		expect(insert).toHaveBeenCalledWith(
			app.tags,
			{
				organizationId: organization.id,
				kind: 'expense',
				name: 'Garden',
				categoryId: input.categoryId,
				archivedAt: null
			},
			{ id: organization.id }
		)
		expect(insert).not.toHaveBeenCalledWith(
			app.transactionTags,
			expect.objectContaining({ tagId: 'old-tag' })
		)
	})
	it('rejects a selected tag archived before transaction persistence', async () => {
		const { db, transaction, insert, wait } = setup()
		vi.spyOn(transaction, 'all').mockResolvedValue([
			{
				id: 'archived-tag',
				name: 'Garden',
				kind: 'expense',
				organizationId: organization.id,
				archivedAt: new Date()
			}
		])
		await expect(createTransaction(db, { ...input, tags: ['Garden'] })).resolves.toMatchObject({
			outcome: 'failed',
			settlement: 'rejected'
		})
		expect(insert).not.toHaveBeenCalledWith(app.transactions, expect.anything(), expect.anything())
		expect(insert).not.toHaveBeenCalledWith(app.tags, expect.anything(), expect.anything())
		expect(wait).not.toHaveBeenCalled()
	})
	it('rejects ambiguous active tag names at the transaction boundary', async () => {
		const { db, transaction, wait } = setup()
		vi.spyOn(transaction, 'all').mockResolvedValue([
			{
				id: 'one',
				organizationId: organization.id,
				kind: 'expense',
				name: 'Garden',
				archivedAt: null
			},
			{
				id: 'two',
				organizationId: organization.id,
				kind: 'expense',
				name: ' garden ',
				archivedAt: null
			}
		])
		await expect(createTransaction(db, { ...input, tags: ['Garden'] })).resolves.toMatchObject({
			outcome: 'failed',
			settlement: 'rejected'
		})
		expect(wait).not.toHaveBeenCalled()
	})
	it('creates income tags with the income category and kind', async () => {
		const { db, transaction, insert } = setup()
		vi.spyOn(transaction, 'all').mockResolvedValue([])
		await createTransaction(db, {
			...input,
			source: { source: 'manual' },
			kind: 'income',
			paymentMethod: 'cash',
			tags: ['Salary']
		})
		expect(insert).toHaveBeenCalledWith(
			app.tags,
			{
				organizationId: organization.id,
				kind: 'income',
				name: 'Salary',
				categoryId: input.categoryId,
				archivedAt: null
			},
			{ id: organization.id }
		)
	})
	it('propagates failures persisting the complete transaction locally', async () => {
		const { db, wait } = setup()
		const failure = new Error('Persistence failed')
		wait.mockRejectedValueOnce(failure)
		await expect(createTransaction(db, input)).resolves.toMatchObject({
			outcome: 'failed',
			settlement: 'unknown'
		})
	})
})

describe('creation resource lifetime', () => {
	const commands = [
		{ type: 'CANCEL', outcome: 'cancelled' },
		{ type: 'INVALIDATE', outcome: 'scopeChanged' },
		{ type: 'SHUTDOWN', outcome: 'closed' }
	] satisfies { type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN'; outcome: string }[]
	it.each(commands)(
		'retains acquisition and rolls back on $type before reading or staging',
		async ({ type, outcome }) => {
			const f = creationFixture()
			const opened = Promise.withResolvers<typeof f.transaction>()
			const cleaned = Promise.withResolvers<boolean>()
			f.rollback.mockReturnValue(cleaned.promise)
			const actor = f.start(
				creationValues,
				f.machine.provide({ actors: { open: fromPromise(() => opened.promise) } })
			)
			await waitFor(actor, (s) => s.matches({ running: { flow: 'opening' } }))
			actor.send({ type })
			expect(actor.getSnapshot().status).toBe('active')
			opened.resolve(f.transaction)
			await waitFor(actor, (s) => s.matches({ running: { flow: 'rollingBack' } }))
			expect(f.all).not.toHaveBeenCalled()
			expect(f.insert).not.toHaveBeenCalled()
			expect(f.commit).not.toHaveBeenCalled()
			expect(actor.getSnapshot().status).toBe('active')
			cleaned.resolve(true)
			expect(await toPromise(actor)).toEqual({ outcome, settlement: 'rejected' })
			expect(actor.getSnapshot().context).toMatchObject({
				input: undefined,
				tx: undefined,
				values: undefined,
				plan: undefined,
				handle: undefined,
				tags: []
			})
		}
	)
	it.each(commands)(
		'drains a pending read on $type and starts no staging',
		async ({ type, outcome }) => {
			const f = creationFixture()
			const read = Promise.withResolvers<[]>()
			f.all.mockReturnValue(read.promise)
			const actor = f.start({ ...creationValues, tags: ['Garden'] })
			await waitFor(actor, (s) => s.matches({ running: { flow: 'reading' } }))
			actor.send({ type })
			expect(f.rollback).not.toHaveBeenCalled()
			read.resolve([])
			expect(await toPromise(actor)).toEqual({ outcome, settlement: 'rejected' })
			expect(f.insert).not.toHaveBeenCalled()
			expect(f.commit).not.toHaveBeenCalled()
			expect(f.rollback).toHaveBeenCalledOnce()
		}
	)
	it.each(commands)(
		'drains an issued commit through local settlement on $type',
		async ({ type, outcome }) => {
			const f = creationFixture()
			const persisted = Promise.withResolvers<void>()
			f.wait.mockReturnValue(persisted.promise)
			const actor = f.start()
			await waitFor(actor, (s) => s.matches({ running: { flow: 'settling' } }))
			actor.send({ type })
			expect(actor.getSnapshot().status).toBe('active')
			expect(f.rollback).not.toHaveBeenCalled()
			persisted.resolve()
			expect(await toPromise(actor)).toEqual({ outcome, settlement: 'locallyPersisted' })
			expect(f.beginTransaction).toHaveBeenCalledOnce()
			expect(f.commit).toHaveBeenCalledOnce()
			expect(f.wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
		}
	)
	it('keeps shutdown priority over subsequent cancellation and scope invalidation', async () => {
		const f = creationFixture()
		const pending = Promise.withResolvers<[]>()
		f.all.mockReturnValue(pending.promise)
		const actor = f.start({ ...creationValues, tags: ['Garden'] })
		await waitFor(actor, (s) => s.matches({ running: { flow: 'reading' } }))
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'INVALIDATE' })
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'INVALIDATE' })
		pending.reject(new Error('Read failed after shutdown'))
		expect(await toPromise(actor)).toEqual({ outcome: 'closed', settlement: 'rejected' })
	})
	it.each(['read', 'stage', 'commit', 'settle'] satisfies (
		'read' | 'stage' | 'commit' | 'settle'
	)[])('awaits rollback after a %s error', async (stage) => {
		const f = creationFixture()
		const failure = new Error('Storage failed')
		if (stage === 'read') f.all.mockRejectedValue(failure)
		if (stage === 'stage')
			f.insert.mockImplementation(() => {
				throw failure
			})
		if (stage === 'commit')
			f.commit.mockImplementation(() => {
				throw failure
			})
		if (stage === 'settle') f.wait.mockRejectedValue(failure)
		const cleanup = Promise.withResolvers<boolean>()
		f.rollback.mockReturnValue(cleanup.promise)
		const actor = f.start({ ...creationValues, tags: ['Garden'] })
		await waitFor(actor, (s) => s.matches({ running: { flow: 'rollingBack' } }))
		expect(actor.getSnapshot().status).toBe('active')
		if (stage === 'commit' || stage === 'settle') expect(f.commit).toHaveBeenCalledOnce()
		if (stage === 'settle') expect(f.wait).toHaveBeenCalledOnce()
		cleanup.resolve(true)
		expect(await toPromise(actor)).toMatchObject({
			outcome: 'failed',
			settlement: stage === 'read' || stage === 'stage' ? 'rejected' : 'unknown'
		})
	})
	it.each([false, 'reject'])('reports uncertainty when rollback returns %s', async (result) => {
		const f = creationFixture()
		f.all.mockRejectedValue(new Error('Read failed'))
		if (result === false) f.rollback.mockResolvedValue(false)
		else f.rollback.mockRejectedValue(new Error('Rollback failed'))
		expect(await toPromise(f.start({ ...creationValues, tags: ['Garden'] }))).toMatchObject({
			outcome: 'failed',
			settlement: 'unknown'
		})
	})
	it('does not acquire a transaction after cancellation during validation', async () => {
		const f = creationFixture()
		const actor = f.start()
		actor.send({ type: 'CANCEL' })
		expect(await toPromise(actor)).toEqual({ outcome: 'cancelled', settlement: 'notStarted' })
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('handles synchronous acquisition errors without attempting rollback', async () => {
		const f = creationFixture()
		f.beginTransaction.mockImplementation(() => {
			throw new Error('Could not open')
		})
		expect(await toPromise(f.start())).toMatchObject({
			outcome: 'failed',
			settlement: 'notStarted'
		})
		expect(f.rollback).not.toHaveBeenCalled()
	})
})
