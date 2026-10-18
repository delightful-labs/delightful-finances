import { beforeAll, describe, expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'
import type { MergeConflictInput } from '#lib/schema/account-merge-conflict.js'
import type { MergeEntity } from '#lib/schema/account-merge-mapping.js'
import type { MergeReferencePlan } from '#lib/schema/account-merge-references.js'
import { accountMergeConflictInputSchema } from '#lib/validation/account-merge-conflict.js'
import { mergeEntitySchema } from '#lib/validation/account-merge-origins.js'
import { sameMergeValues } from '#lib/account-merge/conflict.js'
import { fixture, id } from './mapping.fixtures.js'
import { accountMergeReferencesMachine } from './references.js'
import { accountMergeConflictMachine } from './conflict.js'

let plan: MergeReferencePlan
beforeAll(async () => {
	const output = await toPromise(
		createActor(accountMergeReferencesMachine, { input: fixture() }).start()
	)
	if (output.outcome !== 'prepared') throw new Error('Expected prepared fixture')
	plan = output.plan
})
function observation(entity: MergeEntity = 'accounts', sourceId?: string): MergeConflictInput {
	const candidate = plan.candidates[entity].find((row) =>
		sourceId ? row.mapping.sourceId === sourceId : row.mapping.kind === 'origin'
	)
	if (!candidate) throw new Error('Missing candidate')
	return accountMergeConflictInputSchema.parse({
		entity,
		sourceOrganizationId: id(2),
		destination: plan.destination,
		candidate,
		target: null,
		receipt: null,
		peers: []
	})
}
function receipt(input: MergeConflictInput) {
	return {
		id: input.candidate.mapping.originId,
		organizationId: input.destination.organizationId,
		sourceOrganizationId: input.sourceOrganizationId,
		sourceEntity: input.entity,
		sourceRecordId: input.candidate.mapping.sourceId,
		destinationRecordId: input.candidate.mapping.destinationId
	}
}
function target(input: MergeConflictInput, change: Record<string, unknown> = {}) {
	return { ...input, target: { ...input.candidate.value, ...change } }
}
async function classify(input: unknown) {
	const actor = createActor(accountMergeConflictMachine, { input }).start()
	const output = await toPromise(actor)
	expect(actor.getSnapshot().context.input).toBeUndefined()
	expect(actor.getSnapshot().status).toBe('done')
	return output
}
async function decision(input: MergeConflictInput, outcome: object) {
	expect(await classify(input)).toEqual({
		outcome: 'classified',
		decision: {
			entity: input.entity,
			sourceId: input.candidate.mapping.sourceId,
			destinationId: input.candidate.mapping.destinationId,
			originId: input.candidate.mapping.originId,
			...outcome
		}
	})
}

describe('merge per-record decisions', () => {
	it.each(mergeEntitySchema.options)('classifies a new ordinary %s record', async (entity) => {
		await decision(observation(entity), { outcome: 'addition' })
	})
	it.each(mergeEntitySchema.options)(
		'refuses to reuse occupied ordinary %s IDs even for equal values',
		async (entity) => {
			const input = observation(entity)
			await decision(accountMergeConflictInputSchema.parse(target(input)), {
				outcome: 'conflict',
				reason: 'destination-collision'
			})
		}
	)
	it.each(mergeEntitySchema.options)(
		'honors a %s receipt after target deletion without resurrecting data',
		async (entity) => {
			const input = observation(entity)
			input.receipt = receipt(input)
			await decision(input, { outcome: 'existing', reason: 'recorded-origin' })
		}
	)
	it('honors a receipt after destination edits and differing source provider peers', async () => {
		const input = observation('transactions', id(12))
		const changed = accountMergeConflictInputSchema.parse({
			...target(input, { amountMinor: 9000 }),
			receipt: receipt(input),
			peers: [{ ...input.candidate.value, memo: 'Different source note' }]
		})
		const original = structuredClone(changed)
		await decision(changed, { outcome: 'existing', reason: 'recorded-origin' })
		expect(changed).toEqual(original)
	})
	it.each([
		['id', id(90)],
		['organizationId', id(90)],
		['sourceOrganizationId', id(90)],
		['sourceEntity', 'tags'],
		['sourceRecordId', id(90)],
		['destinationRecordId', id(90)]
	])('rejects a receipt with mismatched %s', async (field, value) => {
		const input = observation()
		input.receipt = accountMergeConflictInputSchema.parse({
			...input,
			receipt: { ...receipt(input), [field]: value }
		}).receipt
		await decision(input, { outcome: 'conflict', reason: 'invalid-provenance' })
	})
	it('does not fall through from invalid provenance to an otherwise equal provider target', async () => {
		const input = observation('transactions', id(12))
		await decision(
			accountMergeConflictInputSchema.parse({
				...target(input),
				receipt: { ...receipt(input), sourceRecordId: id(90) }
			}),
			{ outcome: 'conflict', reason: 'invalid-provenance' }
		)
	})
	it('reuses active system categories by kind despite label differences', async () => {
		const input = observation('categories', id(6))
		await decision(
			accountMergeConflictInputSchema.parse(target(input, { name: 'Destination translation' })),
			{ outcome: 'existing', reason: 'system-category' }
		)
	})
	it('reports a missing system category rather than recreating it', async () => {
		await decision(observation('categories', id(6)), {
			outcome: 'conflict',
			reason: 'missing-system-category'
		})
	})
	it.each([{ isSystem: false }, { kind: 'income' }, { archivedAt: '2026-10-16T00:00:00Z' }])(
		'rejects incompatible system target %j',
		async (change) => {
			const input = observation('categories', id(6))
			await decision(accountMergeConflictInputSchema.parse(target(input, change)), {
				outcome: 'conflict',
				reason: 'invalid-system-category'
			})
		}
	)
	it('keeps recorded system-category origins existing after category deletion', async () => {
		const input = observation('categories', id(6))
		input.receipt = receipt(input)
		await decision(input, { outcome: 'existing', reason: 'recorded-origin' })
	})
	it('adds an absent provider target when all source peers agree', async () => {
		const input = observation('transactions', id(12))
		input.peers = [structuredClone(input.candidate.value)]
		await decision(input, { outcome: 'addition' })
	})
	it('reuses a provider target only when every projected value agrees', async () => {
		const input = observation('transactions', id(12))
		await decision(accountMergeConflictInputSchema.parse(target(input)), {
			outcome: 'existing',
			reason: 'provider-identity'
		})
	})
	it.each([
		{ accountId: id(90) },
		{ categoryId: id(90) },
		{ amountMinor: 999 },
		{ currency: 'EUR' },
		{ bookedOn: '2026-10-18' },
		{ memo: 'Changed note' },
		{ paymentMethod: 'electronic' },
		{ batchId: null },
		{ checkDetailsId: id(90) },
		{ externalId: 'another-provider-id' },
		{ source: 'manual' },
		{ kind: 'income' }
	])('reports provider destination differences %j', async (change) => {
		const input = observation('transactions', id(12))
		await decision(accountMergeConflictInputSchema.parse(target(input, change)), {
			outcome: 'conflict',
			reason: 'provider-values'
		})
	})
	it.each([{ accountId: id(90) }, { amountMinor: 999 }, { memo: 'Different source note' }])(
		'keeps conflicting provider peers visible %j',
		async (change) => {
			const input = observation('transactions', id(12))
			const changed = accountMergeConflictInputSchema.parse({
				...target(input),
				peers: [{ ...input.candidate.value, ...change }]
			})
			await decision(changed, { outcome: 'conflict', reason: 'source-provider-collision' })
		}
	)
	it('blocks conflicting source peers even when the destination is absent', async () => {
		const input = observation('transactions', id(12))
		await decision(
			accountMergeConflictInputSchema.parse({
				...input,
				peers: [{ ...input.candidate.value, amountMinor: 999 }]
			}),
			{ outcome: 'conflict', reason: 'source-provider-collision' }
		)
	})
})

describe('merge observation validation', () => {
	it.each(['target', 'receipt', 'peers'])('requires an explicit %s observation', async (field) => {
		const input = { ...observation(), [field]: undefined }
		expect(await classify(input)).toEqual({ outcome: 'failed', code: 'invalid-input' })
	})
	it.each([
		{ recoveryPhrase: 'private phrase' },
		{ entity: 'attachments' },
		{ sourceOrganizationId: 'invalid' },
		{ receipt: { accessUrl: 'private credential' } }
	])('rejects malformed or unsupported input %j', async (change) => {
		expect(await classify({ ...observation(), ...change })).toEqual({
			outcome: 'failed',
			code: 'invalid-input'
		})
	})
	it('uses entity-specific row validation rather than accepting another table shape', async () => {
		const input = observation()
		expect(
			await classify({
				...input,
				candidate: { ...input.candidate, value: observation('tags').candidate.value }
			})
		).toEqual({ outcome: 'failed', code: 'invalid-input' })
	})
	it.each([{ entity: 'tags' }, { kind: 'provider-transaction' }, { destinationId: id(90) }])(
		'rejects inconsistent mapping metadata %j',
		async (change) => {
			const input = observation()
			expect(
				await classify({
					...input,
					candidate: { ...input.candidate, mapping: { ...input.candidate.mapping, ...change } }
				})
			).toEqual({ outcome: 'failed', code: 'invalid-observation' })
		}
	)
	it('rejects a provider record routed as an ordinary origin', async () => {
		const input = observation('transactions', id(12))
		expect(
			await classify({
				...input,
				candidate: { ...input.candidate, mapping: { ...input.candidate.mapping, kind: 'origin' } }
			})
		).toEqual({ outcome: 'failed', code: 'invalid-observation' })
	})
	it.each(['candidate', 'target', 'peer'])(
		'rejects cross-scope %s rows before honoring a receipt',
		async (location) => {
			const input = observation()
			const foreign = { ...input.candidate.value, organizationId: id(90) }
			const changed = {
				...input,
				receipt: receipt(input),
				...(location === 'candidate' ? { candidate: { ...input.candidate, value: foreign } } : {}),
				...(location === 'target' ? { target: foreign } : {}),
				...(location === 'peer' ? { peers: [foreign] } : {})
			}
			expect(await classify(changed)).toEqual({ outcome: 'failed', code: 'invalid-observation' })
		}
	)
	it.each(['target', 'peer'])(
		'rejects wrong destination IDs in %s observations',
		async (location) => {
			const input = observation()
			const wrong = { ...input.candidate.value, id: id(90) }
			expect(
				await classify({
					...input,
					...(location === 'target' ? { target: wrong } : { peers: [wrong] })
				})
			).toEqual({ outcome: 'failed', code: 'invalid-observation' })
		}
	)
	it('rejects identical source and destination organizations', async () => {
		const input = observation()
		expect(
			await classify({ ...input, sourceOrganizationId: input.destination.organizationId })
		).toEqual({ outcome: 'failed', code: 'invalid-observation' })
	})
	it('preserves whitespace and archive representations without form normalization', () => {
		const input = observation()
		const changed = {
			...input.candidate.value,
			name: '  Account  ',
			archivedAt: '2026-10-16T01:02:03.456-04:00'
		}
		const parsed = accountMergeConflictInputSchema.parse({
			...input,
			candidate: { ...input.candidate, value: changed },
			target: changed
		})
		expect(parsed.candidate.value).toEqual(changed)
		expect(parsed.target).toEqual(changed)
	})
})

describe('lossless scalar comparison', () => {
	it('ignores key order without ignoring fields, nulls or whitespace', () => {
		expect(
			sameMergeValues({ memo: ' Note ', amountMinor: 100 }, { amountMinor: 100, memo: ' Note ' })
		).toBe(true)
		expect(sameMergeValues({ memo: ' Note ' }, { memo: 'Note' })).toBe(false)
		expect(sameMergeValues({ memo: null }, {})).toBe(false)
		expect(sameMergeValues({ memo: null }, { memo: '' })).toBe(false)
		expect(sameMergeValues({ memo: null }, { memo: null, amountMinor: 0 })).toBe(false)
	})
})
