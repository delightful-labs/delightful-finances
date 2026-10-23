import { describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise, toPromise, waitFor } from 'xstate'
import { app, type Tag, type TransactionRow } from '#lib/schema.js'
import type { AppTransaction } from '#lib/domain/transaction.js'
import { creationValues } from './transaction-create.fixture.js'
import {
	editFixture,
	editId,
	existingTransaction,
	type EditRecords
} from './transaction-edit.fixture.js'

const historical = {
	id: 'historical',
	organizationId: creationValues.organizationId,
	name: 'Historical',
	kind: 'expense',
	categoryId: null,
	archivedAt: new Date('2026-10-18')
} satisfies Tag
const link = {
	id: 'link',
	organizationId: creationValues.organizationId,
	transactionId: editId,
	tagId: historical.id
}
const details = {
	id: editId,
	transactionId: editId,
	organizationId: creationValues.organizationId,
	accountId: creationValues.accountId,
	checkNumber: '100',
	checkDate: creationValues.bookedOn,
	payerName: 'Original payer',
	bankName: 'Original bank',
	memoOnCheck: 'Original check memo'
} satisfies EditRecords['details'][number]
const checkValues: AppTransaction = {
	...creationValues,
	kind: 'income',
	source: { source: 'manual' },
	paymentMethod: 'check',
	checkDetails: { checkNumber: ' 200 ', checkDate: '2026-10-19' }
}
const checkRow: TransactionRow = {
	...existingTransaction,
	kind: 'income',
	paymentMethod: 'check',
	checkDetailsId: editId
}
const commands = [
	{ type: 'CANCEL', outcome: 'cancelled' },
	{ type: 'INVALIDATE', outcome: 'scopeChanged' },
	{ type: 'SHUTDOWN', outcome: 'closed' }
] satisfies { type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN'; outcome: string }[]

function expectNoWrites(f: ReturnType<typeof editFixture>) {
	expect(f.update).not.toHaveBeenCalled()
	expect(f.remove).not.toHaveBeenCalled()
	expect(f.insert).not.toHaveBeenCalled()
	expect(f.commit).not.toHaveBeenCalled()
}

describe('transaction edit domain invariants and planning', () => {
	it.each([true, false])(
		'preserves or removes archived assignments according to selection: %s',
		async (retained) => {
			const f = editFixture()
			f.records({ links: [link], tags: [historical] })
			expect(
				await toPromise(f.start({ ...creationValues, tags: retained ? [' historical '] : [] }))
			).toEqual({ outcome: 'succeeded', value: undefined, settlement: 'locallyPersisted' })
			expect(f.update).toHaveBeenCalledOnce()
			expect(f.insert).not.toHaveBeenCalled()
			if (retained) expect(f.remove).not.toHaveBeenCalled()
			else expect(f.remove).toHaveBeenCalledExactlyOnceWith(app.transactionTags, link.id)
			expect(f.beginTransaction).toHaveBeenCalledOnce()
			expect(f.commit).toHaveBeenCalledOnce()
			expect(f.wait).toHaveBeenCalledExactlyOnceWith({ tier: 'local' })
		}
	)
	it('preserves unresolved historical links when none are selected', async () => {
		const f = editFixture()
		f.records({ links: [link], tags: [] })
		expect(await toPromise(f.start({ ...creationValues, tags: [] }))).toMatchObject({
			outcome: 'succeeded'
		})
		expect(f.remove).not.toHaveBeenCalled()
		expect(f.insert).not.toHaveBeenCalled()
	})
	it('preserves selected historical assignments despite ambiguous active suggestions', async () => {
		const f = editFixture()
		f.records({
			links: [link],
			tags: [
				historical,
				{ ...historical, id: 'active-a', archivedAt: null },
				{ ...historical, id: 'active-b', archivedAt: null }
			]
		})
		expect(await toPromise(f.start({ ...creationValues, tags: ['Historical'] }))).toMatchObject({
			outcome: 'succeeded'
		})
		expect(f.remove).not.toHaveBeenCalled()
		expect(f.insert).not.toHaveBeenCalled()
	})
	it('rejects ambiguous new names before staging any mutation', async () => {
		const f = editFixture()
		f.records({
			tags: [
				{ ...historical, id: 'a', archivedAt: null },
				{ ...historical, id: 'b', archivedAt: null }
			]
		})
		expect(await toPromise(f.start({ ...creationValues, tags: ['Historical'] }))).toMatchObject({
			outcome: 'failed',
			settlement: 'rejected'
		})
		expectNoWrites(f)
		expect(f.rollback).toHaveBeenCalledOnce()
	})
	it('reuses active tags without changing their category and creates only genuinely new names', async () => {
		const f = editFixture()
		f.records({ tags: [{ ...historical, archivedAt: null }] })
		expect(
			await toPromise(f.start({ ...creationValues, tags: ['HISTORICAL', ' Garden ', 'garden'] }))
		).toMatchObject({ outcome: 'succeeded' })
		const tagWrites = f.insert.mock.calls.filter(([table]) => table === app.tags)
		expect(tagWrites).toHaveLength(1)
		expect(tagWrites[0]?.[1]).toEqual({
			organizationId: creationValues.organizationId,
			kind: 'expense',
			name: 'garden',
			categoryId: creationValues.categoryId,
			archivedAt: null
		})
		expect(f.insert.mock.calls.filter(([table]) => table === app.transactionTags)).toHaveLength(2)
		expect(f.insert).toHaveBeenCalledWith(app.transactionTags, {
			organizationId: creationValues.organizationId,
			transactionId: editId,
			tagId: historical.id
		})
		expect(f.update).not.toHaveBeenCalledWith(app.tags, expect.anything(), expect.anything())
	})
	it('normalizes edits, clears optional fields and preserves immutable transaction fields', async () => {
		const f = editFixture()
		expect(
			await toPromise(f.start({ ...creationValues, description: '  Changed  ', memo: ' ' }))
		).toMatchObject({ outcome: 'succeeded' })
		expect(f.update).toHaveBeenCalledExactlyOnceWith(app.transactions, editId, {
			accountId: creationValues.accountId,
			categoryId: creationValues.categoryId,
			amountMinor: 100,
			currency: 'USD',
			bookedOn: creationValues.bookedOn,
			description: 'Changed',
			memo: null,
			paymentMethod: null,
			checkDetailsId: null
		})
	})
	it.each([
		{ label: 'missing row', rows: [] },
		{ label: 'imported row', rows: [{ ...existingTransaction, source: 'simplefin' }] },
		{ label: 'another workspace', rows: [{ ...existingTransaction, organizationId: 'other' }] },
		{ label: 'another kind', rows: [{ ...existingTransaction, kind: 'income' }] }
	] satisfies { label: string; rows: TransactionRow[] }[])(
		'rejects $label before mutation or relationship reads',
		async ({ rows }) => {
			const f = editFixture()
			f.records({ rows })
			expect(await toPromise(f.start())).toMatchObject({
				outcome: 'failed',
				settlement: 'rejected'
			})
			expectNoWrites(f)
			expect(f.all).toHaveBeenCalledOnce()
			expect(f.rollback).toHaveBeenCalledOnce()
		}
	)
	it.each([
		{
			label: 'cash to check',
			row: { ...checkRow, paymentMethod: 'cash', checkDetailsId: null },
			values: checkValues
		},
		{
			label: 'check to cash',
			row: checkRow,
			values: {
				...creationValues,
				kind: 'income',
				source: { source: 'manual' },
				paymentMethod: 'cash'
			}
		},
		{
			label: 'moving a check account',
			row: checkRow,
			values: { ...checkValues, accountId: 'other' }
		}
	] satisfies { label: string; row: TransactionRow; values: AppTransaction }[])(
		'rejects $label',
		async ({ row, values }) => {
			const f = editFixture()
			f.records({ rows: [row], details: [details] })
			expect(await toPromise(f.start(values))).toMatchObject({
				outcome: 'failed',
				settlement: 'rejected'
			})
			expectNoWrites(f)
			expect(f.all).toHaveBeenCalledOnce()
		}
	)
	it.each([
		{ label: 'missing check details', values: checkValues, row: checkRow, details: [] },
		{
			label: 'duplicate check details',
			values: checkValues,
			row: checkRow,
			details: [details, { ...details, id: 'duplicate' }]
		},
		{
			label: 'mismatched details ID',
			values: checkValues,
			row: checkRow,
			details: [{ ...details, id: 'wrong' }]
		},
		{
			label: 'orphan details on non-check',
			values: creationValues,
			row: existingTransaction,
			details: [details]
		}
	] satisfies {
		label: string
		values: AppTransaction
		row: TransactionRow
		details: EditRecords['details']
	}[])('rejects $label before staging', async (scenario) => {
		const f = editFixture()
		f.records({ rows: [scenario.row], details: scenario.details })
		expect(await toPromise(f.start(scenario.values))).toMatchObject({
			outcome: 'failed',
			settlement: 'rejected'
		})
		expectNoWrites(f)
	})
	it('updates the linked check while retaining payer, bank and check memo metadata', async () => {
		const f = editFixture()
		f.records({ rows: [checkRow], details: [details] })
		expect(await toPromise(f.start(checkValues))).toMatchObject({ outcome: 'succeeded' })
		expect(f.update).toHaveBeenCalledTimes(2)
		expect(f.update).toHaveBeenCalledWith(app.checkDetails, editId, {
			organizationId: checkValues.organizationId,
			accountId: checkValues.accountId,
			checkNumber: '200',
			checkDate: '2026-10-19'
		})
		expect(f.update).toHaveBeenCalledWith(
			app.transactions,
			editId,
			expect.objectContaining({ checkDetailsId: editId, paymentMethod: 'check' })
		)
	})
	it('rejects invalid values and missing IDs before acquiring a transaction', async () => {
		const f = editFixture()
		expect(await toPromise(f.start({ ...creationValues, bookedOn: 'invalid' }))).toMatchObject({
			outcome: 'failed',
			settlement: 'notStarted'
		})
		const input = f.input()
		input.request.scope.transactionId = null
		const actor = createActor(f.machine, { input }).start()
		expect(await toPromise(actor)).toMatchObject({ outcome: 'failed', settlement: 'notStarted' })
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
})

describe('transaction edit resource lifetime', () => {
	it.each(commands)(
		'retains pending acquisition and rolls back on $type',
		async ({ type, outcome }) => {
			const f = editFixture()
			const open = Promise.withResolvers<typeof f.transaction>()
			const cleanup = Promise.withResolvers<boolean>()
			f.rollback.mockReturnValue(cleanup.promise)
			const actor = f.start(
				creationValues,
				f.machine.provide({ actors: { open: fromPromise(() => open.promise) } })
			)
			await waitFor(actor, (s) => s.matches({ running: { flow: 'opening' } }))
			actor.send({ type })
			open.resolve(f.transaction)
			await waitFor(actor, (s) => s.matches({ running: { flow: 'rollingBack' } }))
			expect(actor.getSnapshot().status).toBe('active')
			expect(f.all).not.toHaveBeenCalled()
			expectNoWrites(f)
			cleanup.resolve(true)
			expect(await toPromise(actor)).toEqual({ outcome, settlement: 'rejected' })
			expect(actor.getSnapshot().context).toMatchObject({
				input: undefined,
				tx: undefined,
				existing: undefined,
				relationships: undefined,
				values: undefined,
				plan: undefined,
				handle: undefined
			})
		}
	)
	it.each(commands)(
		'drains the current-row read on $type without issuing relationship reads',
		async ({ type, outcome }) => {
			const f = editFixture()
			const read = Promise.withResolvers<TransactionRow[]>()
			f.all.mockReset().mockReturnValue(read.promise)
			const actor = f.start()
			await waitFor(actor, (s) => s.matches({ running: { flow: 'readingTransaction' } }))
			actor.send({ type })
			expect(f.rollback).not.toHaveBeenCalled()
			read.resolve([existingTransaction])
			expect(await toPromise(actor)).toEqual({ outcome, settlement: 'rejected' })
			expect(f.all).toHaveBeenCalledOnce()
			expectNoWrites(f)
		}
	)
	it.each(['reject', 'throw'])(
		'retains all related reads when one query fails by %s',
		async (failure) => {
			const f = editFixture()
			const pendingTags = Promise.withResolvers<EditRecords['tags']>()
			const pendingDetails = Promise.withResolvers<EditRecords['details']>()
			f.all.mockReset().mockResolvedValueOnce([existingTransaction])
			if (failure === 'throw')
				f.all.mockImplementationOnce(() => {
					throw new Error('Links query threw')
				})
			else f.all.mockRejectedValueOnce(new Error('Links query rejected'))
			f.all.mockReturnValueOnce(pendingTags.promise).mockReturnValueOnce(pendingDetails.promise)
			const actor = f.start()
			await vi.waitFor(() => expect(f.all).toHaveBeenCalledTimes(4))
			expect(f.rollback).not.toHaveBeenCalled()
			expectNoWrites(f)
			actor.send({ type: 'SHUTDOWN' })
			pendingTags.resolve([])
			await Promise.resolve()
			expect(f.rollback).not.toHaveBeenCalled()
			pendingDetails.resolve([])
			expect(await toPromise(actor)).toEqual({ outcome: 'closed', settlement: 'rejected' })
			expectNoWrites(f)
		}
	)
	it.each(commands)(
		'retains related reads on $type and stages nothing afterward',
		async ({ type, outcome }) => {
			const f = editFixture()
			const pending = Promise.withResolvers<EditRecords['details']>()
			f.all
				.mockReset()
				.mockResolvedValueOnce([existingTransaction])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockReturnValueOnce(pending.promise)
			const actor = f.start()
			await vi.waitFor(() => expect(f.all).toHaveBeenCalledTimes(4))
			actor.send({ type })
			expect(f.rollback).not.toHaveBeenCalled()
			pending.resolve([])
			expect(await toPromise(actor)).toEqual({ outcome, settlement: 'rejected' })
			expectNoWrites(f)
		}
	)
	it.each(commands)('drains issued commit settlement on $type', async ({ type, outcome }) => {
		const f = editFixture()
		const pending = Promise.withResolvers<void>()
		f.wait.mockReturnValue(pending.promise)
		const actor = f.start()
		await waitFor(actor, (s) => s.matches({ running: { flow: 'settling' } }))
		actor.send({ type })
		expect(actor.getSnapshot().status).toBe('active')
		expect(f.rollback).not.toHaveBeenCalled()
		pending.resolve()
		expect(await toPromise(actor)).toEqual({ outcome, settlement: 'locallyPersisted' })
		expect(f.commit).toHaveBeenCalledOnce()
		expect(f.beginTransaction).toHaveBeenCalledOnce()
	})
	it.each(['read', 'stage', 'commit', 'settle'] satisfies (
		'read' | 'stage' | 'commit' | 'settle'
	)[])('awaits rollback after a %s failure', async (stage) => {
		const f = editFixture()
		const error = new Error('Storage failure')
		if (stage === 'read') f.all.mockReset().mockRejectedValue(error)
		if (stage === 'stage')
			f.update.mockImplementation(() => {
				throw error
			})
		if (stage === 'commit')
			f.commit.mockImplementation(() => {
				throw error
			})
		if (stage === 'settle') f.wait.mockRejectedValue(error)
		const cleanup = Promise.withResolvers<boolean>()
		f.rollback.mockReturnValue(cleanup.promise)
		const actor = f.start()
		await waitFor(actor, (s) => s.matches({ running: { flow: 'rollingBack' } }))
		expect(actor.getSnapshot().status).toBe('active')
		if (stage === 'commit' || stage === 'settle') expect(f.commit).toHaveBeenCalledOnce()
		cleanup.resolve(true)
		expect(await toPromise(actor)).toMatchObject({
			outcome: 'failed',
			settlement: stage === 'read' || stage === 'stage' ? 'rejected' : 'unknown'
		})
	})
	it.each([false, 'reject'])('reports uncertainty for rollback result %s', async (result) => {
		const f = editFixture()
		f.all.mockReset().mockRejectedValue(new Error('Read failed'))
		if (result === false) f.rollback.mockResolvedValue(false)
		else f.rollback.mockRejectedValue(new Error('Rollback failed'))
		expect(await toPromise(f.start())).toMatchObject({ outcome: 'failed', settlement: 'unknown' })
	})
	it('preserves shutdown priority over later cancellation while reads drain', async () => {
		const f = editFixture()
		const read = Promise.withResolvers<TransactionRow[]>()
		f.all.mockReset().mockReturnValue(read.promise)
		const actor = f.start()
		await waitFor(actor, (s) => s.matches({ running: { flow: 'readingTransaction' } }))
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'INVALIDATE' })
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'INVALIDATE' })
		read.reject(new Error('Read failed'))
		expect(await toPromise(actor)).toEqual({ outcome: 'closed', settlement: 'rejected' })
	})
})

describe('transaction edit staging boundaries', () => {
	it('rolls back without committing when cancellation is raised while staging', async () => {
		const f = editFixture()
		const actor = createActor(f.machine, { input: f.input() })
		f.update.mockImplementation(() => {
			actor.send({ type: 'CANCEL' })
		})
		actor.start()
		expect(await toPromise(actor)).toEqual({ outcome: 'cancelled', settlement: 'rejected' })
		expect(f.update).toHaveBeenCalledOnce()
		expect(f.rollback).toHaveBeenCalledOnce()
		expect(f.commit).not.toHaveBeenCalled()
	})
	it.each([
		{ ...historical },
		{ ...historical, kind: 'income', archivedAt: null },
		{ ...historical, kind: null, archivedAt: null },
		{ ...historical, organizationId: 'other', archivedAt: null }
	] satisfies Tag[])(
		'creates a new typed assignment instead of reusing ineligible tag %j',
		async (tag) => {
			const f = editFixture()
			f.records({ tags: [tag] })
			expect(await toPromise(f.start({ ...creationValues, tags: ['Historical'] }))).toMatchObject({
				outcome: 'succeeded'
			})
			expect(f.insert).toHaveBeenCalledWith(
				app.tags,
				{
					organizationId: creationValues.organizationId,
					kind: 'expense',
					name: 'Historical',
					categoryId: creationValues.categoryId,
					archivedAt: null
				},
				{ id: expect.any(String) }
			)
			expect(f.insert).not.toHaveBeenCalledWith(
				app.transactionTags,
				expect.objectContaining({ tagId: tag.id })
			)
		}
	)
})
