import { describe, expect, it, vi } from 'vitest'
import {
	createActor,
	fromPromise,
	toPromise,
	waitFor,
	type ActorRefFrom,
	type InputFrom,
	type OutputFrom
} from 'xstate'
import { mergeReferencePlan } from '#lib/account-merge/references.js'
import type { AccountMergeMappingInput } from '#lib/schema/account-merge-mapping.js'
import { mergeEntitySchema } from '#lib/validation/account-merge-origins.js'
import { accountMergePreparationMachine } from './preparation.js'
import { fixture, id } from './mapping.fixtures.js'

type Identities = typeof accountMergePreparationMachine.implementations.actors.identities
type References = typeof accountMergePreparationMachine.implementations.actors.references
function cleared(actor: ActorRefFrom<typeof accountMergePreparationMachine>) {
	expect(actor.getSnapshot().context).toMatchObject({
		input: undefined,
		mappings: [],
		plan: undefined
	})
}
async function prepared(input = fixture()) {
	const actor = createActor(accountMergePreparationMachine, { input }).start()
	const result = await toPromise(actor)
	expect(result.outcome).toBe('prepared')
	if (result.outcome !== 'prepared') throw new Error('Expected prepared graph')
	cleared(actor)
	return result.plan
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing fixture record')
	return value
}

describe('merge reference preparation', () => {
	it('rewrites the complete graph while preserving captured values and source attribution', async () => {
		const input = fixture()
		const source = structuredClone(input)
		const plan = await prepared(input)
		const rows = plan.candidates
		const account = required(rows.accounts[0]).value
		const category = required(rows.categories[0]).value
		const incomeCategory = required(rows.categories[1]).value
		const tag = required(rows.tags[0]).value
		const expense = required(rows.transactions[0]).value
		const income = required(rows.transactions[2]).value
		const check = required(rows.checkDetails[0]).value
		const batch = required(rows.transactionBatches[0]).value
		const link = required(rows.transactionTags[0]).value
		expect(tag.categoryId).toBe(category.id)
		expect(expense).toMatchObject({
			accountId: account.id,
			categoryId: category.id,
			batchId: batch.id,
			checkDetailsId: null
		})
		expect(income).toMatchObject({
			accountId: account.id,
			categoryId: incomeCategory.id,
			checkDetailsId: check.id,
			batchId: batch.id
		})
		expect(check).toMatchObject({ transactionId: income.id, accountId: account.id })
		expect(link).toMatchObject({ transactionId: expense.id, tagId: tag.id })
		expect(category.id).toBe(id(20))
		expect(required(rows.categories[0]).mapping.kind).toBe('system-category')
		expect(plan.destination).toEqual(input.destination)
		for (const entity of mergeEntitySchema.options) {
			expect(rows[entity]).toHaveLength(input.snapshot[entity].length)
			for (const candidate of rows[entity]) {
				expect(candidate.value.organizationId).toBe(input.destination.organizationId)
				expect(candidate.value.id).toBe(candidate.mapping.destinationId)
				expect(candidate.value.id).not.toBe(candidate.mapping.sourceId)
				expect(candidate.mapping.entity).toBe(entity)
				const original = required(
					input.snapshot[entity].find((row) => row.id === candidate.mapping.sourceId)
				)
				// All non-reference financial fields must remain byte-for-byte equivalent.
				const references = new Set([
					'id',
					'organizationId',
					'accountId',
					'categoryId',
					'transactionId',
					'tagId',
					'batchId',
					'checkDetailsId'
				])
				for (const [field, value] of Object.entries(original)) {
					if (!references.has(field)) expect(Reflect.get(candidate.value, field)).toEqual(value)
				}
			}
		}
		expect(plan.bankAccountLinks).toEqual(source.snapshot.bankAccountLinks)
		expect(plan.bankAccountLinks).not.toBe(input.snapshot.bankAccountLinks)
		expect(plan.bankAccountLinks[0]?.organizationId).toBe(input.snapshot.sourceOrganization.id)
		expect(plan.excludedConnectionCount).toBe(1)
		expect(input).toEqual(source)
	})

	it('retains null optional references and exact whitespace, archive and check values', async () => {
		const input = fixture()
		const tag = required(input.snapshot.tags[0])
		tag.categoryId = null
		tag.name = '  Tag  '
		tag.archivedAt = '2026-10-16T01:02:03.456-04:00'
		const expense = required(input.snapshot.transactions[0])
		expense.batchId = null
		expense.memo = '  preserve\nthis note  '
		const check = required(input.snapshot.checkDetails[0])
		check.payerName = '  Payer  '
		check.bankName = 'Bank'
		check.memoOnCheck = 'Original check memo'
		const plan = await prepared(input)
		expect(plan.candidates.tags[0]?.value).toMatchObject({
			categoryId: null,
			name: tag.name,
			archivedAt: tag.archivedAt
		})
		expect(plan.candidates.transactions[0]?.value).toMatchObject({
			batchId: null,
			checkDetailsId: null,
			memo: expense.memo,
			paymentMethod: null,
			externalId: null
		})
		expect(plan.candidates.checkDetails[0]?.value).toMatchObject({
			checkNumber: '001',
			payerName: check.payerName,
			bankName: check.bankName,
			memoOnCheck: check.memoOnCheck
		})
	})

	it('preserves distinct source provider collisions and their remapped tag dependencies', async () => {
		const input = fixture()
		const provider = required(input.snapshot.transactions.find((row) => row.source === 'simplefin'))
		input.snapshot.transactions.push({
			...provider,
			id: id(60),
			accountId: id(18),
			amountMinor: 5678,
			memo: 'Conflicting source value'
		})
		input.snapshot.transactionTags.push({
			id: id(61),
			organizationId: id(2),
			transactionId: id(60),
			tagId: id(8)
		})
		const plan = await prepared(input)
		const collisions = plan.candidates.transactions.filter(
			(candidate) => candidate.mapping.kind === 'provider-transaction'
		)
		expect(collisions).toHaveLength(2)
		const first = required(collisions[0])
		const second = required(collisions[1])
		expect(first.value.id).toBe(second.value.id)
		expect(first.mapping.originId).not.toBe(second.mapping.originId)
		expect(first.value.accountId).not.toBe(second.value.accountId)
		expect(first.value.amountMinor).toBe(1234)
		expect(second.value.amountMinor).toBe(5678)
		expect(plan.candidates.transactionTags[1]?.value.transactionId).toBe(second.value.id)
		expect(plan.candidates.transactionTags[1]?.value.tagId).toBe(plan.candidates.tags[0]?.value.id)
		expect(first.value.externalId).toBe(provider.externalId)
		expect(second.value.externalId).toBe(provider.externalId)
	})

	it('keys mappings by entity when source tables share an ID', async () => {
		const input = fixture()
		required(input.snapshot.batchTemplates[0]).id = id(5)
		const plan = await prepared(input)
		expect(plan.candidates.accounts[0]?.value.id).not.toBe(
			plan.candidates.batchTemplates[0]?.value.id
		)
	})

	it('returns empty candidates for a genuinely empty validated graph', async () => {
		const input = fixture()
		for (const entity of mergeEntitySchema.options) input.snapshot[entity].splice(0)
		input.snapshot.bankAccountLinks = []
		input.snapshot.excludedConnectionCount = 0
		const plan = await prepared(input)
		for (const entity of mergeEntitySchema.options) expect(plan.candidates[entity]).toEqual([])
		expect(plan.bankAccountLinks).toEqual([])
		expect(plan.excludedConnectionCount).toBe(0)
	})

	it.each([
		{ code: 'invalid-input', change: () => ({}) },
		{
			code: 'invalid-input',
			change: (input: AccountMergeMappingInput) => ({ ...input, recoveryPhrase: 'private' })
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
			code: 'missing-system-category',
			change: (input: AccountMergeMappingInput) => ({ ...input, categories: [] })
		}
	])('propagates $code and clears preparation data', async ({ code, change }) => {
		const actor = createActor(accountMergePreparationMachine, { input: change(fixture()) }).start()
		await expect(toPromise(actor)).resolves.toEqual({ outcome: 'failed', code })
		cleared(actor)
	})

	it('handles child allocation rejection without exposing private errors', async () => {
		const allocation = accountMergePreparationMachine.provide({
			actors: {
				identities: fromPromise<OutputFrom<Identities>, InputFrom<Identities>>(async () => {
					throw new Error('private allocation failure')
				})
			}
		})
		const actor = createActor(allocation, {
			input: fixture()
		}).start()
		await expect(toPromise(actor)).resolves.toEqual({
			outcome: 'failed',
			code: 'identity-allocation-failed'
		})
		cleared(actor)
	})

	it('rejects a missing allocated reference rather than leaving a source ID in the plan', () => {
		const input = fixture()
		expect(() =>
			mergeReferencePlan(input.snapshot, {
				destination: input.destination,
				records: []
			})
		).toThrow('Missing allocated merge reference')
	})

	it('handles projection failure and clears both source and allocation', async () => {
		const references = fromPromise<OutputFrom<References>, InputFrom<References>>(async () => {
			throw new Error('private projection failure')
		})
		const actor = createActor(accountMergePreparationMachine.provide({ actors: { references } }), {
			input: fixture()
		}).start()
		await expect(toPromise(actor)).resolves.toEqual({
			outcome: 'failed',
			code: 'reference-mapping-failed'
		})
		cleared(actor)
	})

	for (const stage of ['allocation', 'references']) {
		for (const command of ['CANCEL', 'SHUTDOWN'] satisfies ('CANCEL' | 'SHUTDOWN')[]) {
			it.each(['resolve', 'reject'])(`${command} during ${stage} ignores late %s`, async (late) => {
				const allocationPending = Promise.withResolvers<{
					destinationId: string
					originId: string
				}>()
				const referencePending = Promise.withResolvers<OutputFrom<References>>()
				const projection = vi.fn(() => referencePending.promise)
				const machine = accountMergePreparationMachine.provide({
					actors: {
						...(stage === 'allocation'
							? { identities: fromPromise(() => allocationPending.promise) }
							: {}),
						references: fromPromise<OutputFrom<References>, InputFrom<References>>(projection)
					}
				})
				const actor = createActor(machine, { input: fixture() }).start()
				await waitFor(actor, (state) =>
					state.matches(stage === 'allocation' ? 'allocatingOriginIdentity' : 'rewriting')
				)
				actor.send({ type: command })
				const outcome = command === 'CANCEL' ? 'cancelled' : 'closed'
				await expect(toPromise(actor)).resolves.toEqual({ outcome })
				if (stage === 'allocation') {
					if (late === 'resolve')
						allocationPending.resolve({ destinationId: id(70), originId: id(71) })
					else allocationPending.reject(new Error('private late allocation rejection'))
					await allocationPending.promise.catch(() => undefined)
				} else {
					if (late === 'resolve') referencePending.resolve(await prepared())
					else referencePending.reject(new Error('private late projection rejection'))
					await referencePending.promise.catch(() => undefined)
				}
				await Promise.resolve()
				expect(actor.getSnapshot().output).toEqual({ outcome })
				expect(projection).toHaveBeenCalledTimes(stage === 'allocation' ? 0 : 1)
				cleared(actor)
			})
		}
	}
})
