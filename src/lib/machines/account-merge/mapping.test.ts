import { describe, expect, it, vi } from 'vitest'
import {
	createActor,
	fromPromise,
	toPromise,
	waitFor,
	type ActorRefFrom,
	type InputFrom
} from 'xstate'
import { stableUuid } from '#lib/data.js'
import type {
	AccountMergeMappingInput,
	MergeRecordMapping
} from '#lib/schema/account-merge-mapping.js'
import { accountMergeMappingMachine } from './mapping.js'
import { fixture, id, providerId } from './mapping.fixtures.js'

function cleared(actor: ActorRefFrom<typeof accountMergeMappingMachine>) {
	expect(actor.getSnapshot().context).toMatchObject({
		input: undefined,
		records: [],
		categories: [],
		mappings: [],
		index: 0
	})
}
async function mapped(input: AccountMergeMappingInput) {
	const actor = createActor(accountMergeMappingMachine, { input }).start()
	const output = await toPromise(actor)
	expect(output.outcome).toBe('mapped')
	if (output.outcome !== 'mapped') throw new Error('Expected mappings')
	cleared(actor)
	return output.records
}
function find(
	records: readonly MergeRecordMapping[],
	entity: MergeRecordMapping['entity'],
	sourceId: string
) {
	const record = records.find((row) => row.entity === entity && row.sourceId === sourceId)
	if (!record) throw new Error('Expected mapping')
	return record
}

describe('merge identity allocation', () => {
	it('allocates the supported graph without altering source data or creating bank links', async () => {
		const input = fixture()
		const original = structuredClone(input)
		const records = await mapped(input)
		expect(records).toHaveLength(13)
		expect(new Set(records.map((row) => row.entity))).toEqual(
			new Set([
				'accounts',
				'categories',
				'tags',
				'transactions',
				'checkDetails',
				'transactionTags',
				'transactionBatches',
				'batchTemplates'
			])
		)
		expect(input).toEqual(original)
		expect(records.some((row) => row.sourceId === id(16))).toBe(false)
		expect(find(records, 'accounts', id(5)).destinationId).not.toBe(
			find(records, 'accounts', id(18)).destinationId
		)
		expect(find(records, 'transactions', id(9)).destinationId).not.toBe(
			find(records, 'transactions', id(17)).destinationId
		)
	})

	it('reuses exact IDs across retries and source ordering changes', async () => {
		const input = fixture()
		const first = await mapped(input)
		input.snapshot.accounts.reverse()
		input.snapshot.transactions.reverse()
		const repeated = await mapped(input)
		for (const record of first)
			expect(find(repeated, record.entity, record.sourceId)).toEqual(record)
		expect(new Set(first.map((row) => row.originId)).size).toBe(first.length)
	})

	it('uses the existing canonical provider transaction formula while retaining distinct origin receipts', async () => {
		const input = fixture()
		const provider = input.snapshot.transactions.find((row) => row.id === id(12))
		if (!provider) throw new Error('Expected provider transaction')
		input.snapshot.transactions.push({ ...provider, id: id(19) })
		const records = await mapped(input)
		const first = find(records, 'transactions', id(12))
		const second = find(records, 'transactions', id(19))
		expect(first.kind).toBe('provider-transaction')
		expect(first.destinationId).toBe(await stableUuid(id(4), `simplefin-transaction:${providerId}`))
		expect(second.destinationId).toBe(first.destinationId)
		expect(second.originId).not.toBe(first.originId)
	})

	it('scopes ordinary IDs and origins by source organization, entity and destination', async () => {
		const input = fixture()
		// The same UUID in different tables denotes different source entities.
		input.snapshot.batchTemplates[0] = { id: id(5), organizationId: id(2), name: 'Template' }
		const first = await mapped(input)
		const account = find(first, 'accounts', id(5))
		expect(account.destinationId).not.toBe(find(first, 'batchTemplates', id(5)).destinationId)
		expect(account.originId).not.toBe(account.destinationId)
		const destination = structuredClone(input)
		destination.destination.organizationId = id(40)
		destination.categories = destination.categories.map((row) => ({
			...row,
			id: id(41),
			organizationId: id(40)
		}))
		const other = find(await mapped(destination), 'accounts', id(5))
		expect(other.destinationId).not.toBe(account.destinationId)
		expect(other.originId).not.toBe(account.originId)
		const source = structuredClone(input)
		source.snapshot.sourceOrganization.id = id(50)
		for (const rows of [
			source.snapshot.accounts,
			source.snapshot.categories,
			source.snapshot.tags,
			source.snapshot.transactions,
			source.snapshot.checkDetails,
			source.snapshot.transactionTags,
			source.snapshot.transactionBatches,
			source.snapshot.batchTemplates,
			source.snapshot.bankAccountLinks
		])
			for (const row of rows) row.organizationId = id(50)
		const otherSource = find(await mapped(source), 'accounts', id(5))
		expect(otherSource.destinationId).not.toBe(account.destinationId)
		expect(otherSource.originId).not.toBe(account.originId)
	})

	it('matches system categories by kind and ignores archived or ordinary alternatives', async () => {
		const input = fixture()
		input.categories.push(
			{ ...input.categories[0]!, id: id(21), archivedAt: new Date() },
			{ ...input.categories[0]!, id: id(22), isSystem: false }
		)
		const records = await mapped(input)
		expect(find(records, 'categories', id(6))).toMatchObject({
			kind: 'system-category',
			destinationId: id(20)
		})
		expect(find(records, 'categories', id(7)).kind).toBe('origin')
	})

	it('maps an empty supported graph without invoking allocation', async () => {
		const input = fixture()
		Object.assign(input.snapshot, {
			accounts: [],
			categories: [],
			tags: [],
			transactions: [],
			checkDetails: [],
			transactionTags: [],
			transactionBatches: [],
			batchTemplates: [],
			bankAccountLinks: []
		})
		const allocate = vi.fn(async () => ({ destinationId: id(30), originId: id(31) }))
		const actor = createActor(
			accountMergeMappingMachine.provide({ actors: { identities: fromPromise(allocate) } }),
			{ input }
		).start()
		await expect(toPromise(actor)).resolves.toEqual({
			outcome: 'mapped',
			destination: input.destination,
			records: []
		})
		expect(allocate).not.toHaveBeenCalled()
		cleared(actor)
	})

	it.each([
		{ code: 'invalid-input', change: () => ({}) },
		{
			code: 'invalid-input',
			change: (input: AccountMergeMappingInput) => ({ ...input, recoveryPhrase: 'excluded secret' })
		},
		{
			code: 'invalid-input',
			change: (input: AccountMergeMappingInput) => ({
				...input,
				categories: input.categories.map(({ isSystem, ...category }) => category)
			})
		},
		{
			code: 'invalid-input',
			change: (input: AccountMergeMappingInput) => ({
				...input,
				categories: input.categories.map(({ archivedAt, ...category }) => category)
			})
		},
		{
			code: 'invalid-input',
			change: (input: AccountMergeMappingInput) => ({
				...input,
				snapshot: {
					...input.snapshot,
					transactions: input.snapshot.transactions.map((row) => ({ ...row, accountId: id(99) }))
				}
			})
		},
		{
			code: 'same-identity',
			change: (input: AccountMergeMappingInput) => ({
				...input,
				destination: { ...input.destination, identityId: id(1) }
			})
		},
		{
			code: 'same-workspace',
			change: (input: AccountMergeMappingInput) => ({
				...input,
				destination: { ...input.destination, organizationId: id(2) }
			})
		},
		{
			code: 'invalid-destination-categories',
			change: (input: AccountMergeMappingInput) => ({
				...input,
				categories: input.categories.map((row) => ({ ...row, organizationId: id(99) }))
			})
		},
		{
			code: 'invalid-destination-categories',
			change: (input: AccountMergeMappingInput) => ({
				...input,
				categories: [...input.categories, ...input.categories]
			})
		},
		{
			code: 'missing-system-category',
			change: (input: AccountMergeMappingInput) => ({ ...input, categories: [] })
		},
		{
			code: 'ambiguous-system-category',
			change: (input: AccountMergeMappingInput) => ({
				...input,
				categories: [...input.categories, { ...input.categories[0]!, id: id(21) }]
			})
		}
	])('returns $code and clears transient state', async ({ code, change }) => {
		const actor = createActor(accountMergeMappingMachine, { input: change(fixture()) }).start()
		await expect(toPromise(actor)).resolves.toEqual({ outcome: 'failed', code })
		cleared(actor)
	})

	it.each(['identities', 'receipt'] satisfies ('identities' | 'receipt')[])(
		'classifies rejected %s allocation without retaining raw errors',
		async (stage) => {
			const machine = accountMergeMappingMachine.provide({
				actors:
					stage === 'identities'
						? {
								identities: fromPromise<
									{ destinationId: string; originId: string },
									InputFrom<typeof accountMergeMappingMachine.implementations.actors.identities>
								>(async () => {
									throw new Error('private error')
								})
							}
						: {
								receipt: fromPromise<string, { namespace: string; name: string }>(async () => {
									throw new Error('private error')
								})
							}
			})
			const actor = createActor(machine, { input: fixture() }).start()
			await expect(toPromise(actor)).resolves.toEqual({
				outcome: 'failed',
				code: 'identity-allocation-failed'
			})
			cleared(actor)
		}
	)

	it.each(['resolve', 'reject'])(
		'cancels pending system-category receipt allocation and ignores late %s',
		async (late) => {
			const pending = Promise.withResolvers<string>()
			const receipt = vi.fn(() => pending.promise)
			const actor = createActor(
				accountMergeMappingMachine.provide({ actors: { receipt: fromPromise(receipt) } }),
				{ input: fixture() }
			).start()
			await waitFor(actor, (state) => state.matches('allocatingSystemOrigin'))
			actor.send({ type: 'CANCEL' })
			await expect(toPromise(actor)).resolves.toEqual({ outcome: 'cancelled' })
			if (late === 'resolve') pending.resolve(id(30))
			else pending.reject(new Error('late private error'))
			await pending.promise.catch(() => undefined)
			await Promise.resolve()
			expect(receipt).toHaveBeenCalledTimes(1)
			cleared(actor)
		}
	)

	it.each([
		{ command: 'CANCEL', late: 'resolve', outcome: 'cancelled' },
		{ command: 'CANCEL', late: 'reject', outcome: 'cancelled' },
		{ command: 'SHUTDOWN', late: 'resolve', outcome: 'closed' },
		{ command: 'SHUTDOWN', late: 'reject', outcome: 'closed' }
	] satisfies { command: 'CANCEL' | 'SHUTDOWN'; late: 'resolve' | 'reject'; outcome: string }[])(
		'settles $command and ignores late $late',
		async ({ command, late, outcome }) => {
			const pending = Promise.withResolvers<{ destinationId: string; originId: string }>()
			const allocate = vi.fn(() => pending.promise)
			const machine = accountMergeMappingMachine.provide({
				actors: { identities: fromPromise(allocate) }
			})
			const actor = createActor(machine, { input: fixture() }).start()
			expect(allocate).toHaveBeenCalledTimes(1)
			actor.send({ type: command })
			await expect(toPromise(actor)).resolves.toEqual({ outcome })
			if (late === 'resolve') pending.resolve({ destinationId: id(30), originId: id(31) })
			else pending.reject(new Error('late private error'))
			await pending.promise.catch(() => undefined)
			await Promise.resolve()
			expect(allocate).toHaveBeenCalledTimes(1)
			cleared(actor)
		}
	)
})
