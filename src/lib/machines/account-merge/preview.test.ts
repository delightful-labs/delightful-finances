import { describe, expect, it } from 'vitest'
import { createActor, fromPromise, toPromise, type InputFrom, type OutputFrom } from 'xstate'
import { mergePreviewGraph, mergeTargetKey } from '#lib/account-merge/preview.js'
import type { MergeEntity } from '#lib/schema/account-merge-mapping.js'
import type { MergePreviewDecision, MergePreviewResult } from '#lib/schema/account-merge-preview.js'
import { accountMergePreviewInputSchema } from '#lib/validation/account-merge-preview.js'
import { mergeEntitySchema } from '#lib/validation/account-merge-origins.js'
import { fixture, id } from './mapping.fixtures.js'
import { previewFixture } from './preview.fixtures.js'
import { accountMergePreviewMachine } from './preview.js'
import { accountMergePreviewDependencyMachine } from './preview-dependency.js'
import { mergeSnapshotLimits } from '#lib/validation/account-merge.js'

type Graph = typeof accountMergePreviewMachine.implementations.actors.graph
async function preview(input: unknown, machine = accountMergePreviewMachine) {
	const actor = createActor(machine, { input }).start()
	const result = await toPromise(actor)
	expect(actor.getSnapshot().context).toMatchObject({
		input: undefined,
		plan: undefined,
		graph: undefined,
		decisions: new Map(),
		index: 0,
		changes: 0
	})
	return result
}
function summary(result: MergePreviewResult) {
	if (result.outcome !== 'previewed' && result.outcome !== 'partial')
		throw new Error('Expected preview summary')
	return result
}
function find(
	result: MergePreviewResult,
	entity: MergeEntity,
	sourceId: string
): MergePreviewDecision {
	const decision = summary(result).decisions.find(
		(row) => row.entity === entity && row.sourceId === sourceId
	)
	if (!decision) throw new Error('Expected decision')
	return decision
}

describe('composed merge preview', () => {
	it('previews the full graph, including staged archives and a new reciprocal check pair', async () => {
		const { input } = await previewFixture()
		const original = structuredClone(input)
		const result = summary(await preview(input))
		expect(result.outcome).toBe('previewed')
		expect(result.counts).toEqual({
			newTargets: 12,
			existingOrigins: 1,
			conflicts: 0,
			blocked: 0,
			newReceipts: 13
		})
		expect(result.excludedConnectionCount).toBe(1)
		expect(find(result, 'transactions', id(10)).outcome).toBe('addition')
		expect(find(result, 'checkDetails', id(11)).outcome).toBe('addition')
		expect(input).toEqual(original)
		expect(JSON.stringify(result)).not.toContain('Unchanged memo')
		expect(JSON.stringify(result)).not.toContain('bank.example')
	})
	it('handles empty source graphs without claiming destination hydration', async () => {
		const mapping = fixture()
		for (const entity of mergeEntitySchema.options) mapping.snapshot[entity].splice(0)
		mapping.snapshot.bankAccountLinks = []
		const { input } = await previewFixture(mapping)
		expect(summary(await preview(input)).counts).toEqual({
			newTargets: 0,
			existingOrigins: 0,
			conflicts: 0,
			blocked: 0,
			newReceipts: 0
		})
	})
	it('counts equal provider aliases once as targets while retaining each origin receipt', async () => {
		const mapping = fixture()
		const provider = mapping.snapshot.transactions.find((row) => row.source === 'simplefin')
		if (!provider) throw new Error('Missing provider')
		mapping.snapshot.transactions.push({ ...provider, id: id(60) })
		const { input } = await previewFixture(mapping)
		const result = summary(await preview(input))
		expect(result.outcome).toBe('previewed')
		expect(result.counts).toMatchObject({ newTargets: 12, newReceipts: 14 })
		expect(find(result, 'transactions', id(60)).outcome).toBe('addition')
	})
	it('retains conflicting provider aliases and blocks their dependent tag links', async () => {
		const mapping = fixture()
		const provider = mapping.snapshot.transactions.find((row) => row.source === 'simplefin')
		if (!provider) throw new Error('Missing provider')
		mapping.snapshot.transactions.push({ ...provider, id: id(60), amountMinor: 999 })
		mapping.snapshot.transactionTags.push({
			id: id(61),
			organizationId: id(2),
			transactionId: id(60),
			tagId: id(8)
		})
		const { input, plan } = await previewFixture(mapping)
		const graph = mergePreviewGraph(input, plan)
		for (const row of graph.records) expect(row.peers.length).toBeLessThanOrEqual(2)
		const result = await preview(input)
		expect(find(result, 'transactions', id(12))).toMatchObject({
			outcome: 'conflict',
			reason: 'source-provider-collision'
		})
		expect(find(result, 'transactions', id(60))).toMatchObject({
			outcome: 'conflict',
			reason: 'source-provider-collision'
		})
		expect(find(result, 'transactionTags', id(61))).toMatchObject({
			outcome: 'blocked',
			reason: 'unavailable-dependency'
		})
	})
	it('blocks a canonical sibling with invalid provenance without suppressing the conflict', async () => {
		const mapping = fixture()
		const provider = mapping.snapshot.transactions.find((row) => row.source === 'simplefin')
		if (!provider) throw new Error('Missing provider')
		mapping.snapshot.transactions.push({ ...provider, id: id(60) })
		const test = await previewFixture(mapping)
		test.recordOrigin('transactions', id(12), { destinationRecordId: id(99) })
		const result = await preview(test.input)
		expect(find(result, 'transactions', id(12))).toMatchObject({
			outcome: 'conflict',
			reason: 'invalid-provenance'
		})
		expect(find(result, 'transactions', id(60))).toMatchObject({
			outcome: 'blocked',
			reason: 'canonical-group'
		})
	})
	it('does not resurrect a deleted canonical target through a new source alias', async () => {
		const mapping = fixture()
		const provider = mapping.snapshot.transactions.find((row) => row.source === 'simplefin')
		if (!provider) throw new Error('Missing provider')
		mapping.snapshot.transactions.push({ ...provider, id: id(60) })
		const test = await previewFixture(mapping)
		test.recordOrigin('transactions', id(12))
		const result = await preview(test.input)
		expect(find(result, 'transactions', id(12))).toMatchObject({
			outcome: 'existing',
			reason: 'recorded-origin'
		})
		expect(find(result, 'transactions', id(60))).toMatchObject({
			outcome: 'blocked',
			reason: 'unavailable-dependency'
		})
	})
	it('keeps deleted recorded parents existing while blocking new children', async () => {
		const test = await previewFixture()
		test.recordOrigin('accounts', id(5))
		const result = await preview(test.input)
		expect(find(result, 'accounts', id(5))).toMatchObject({
			outcome: 'existing',
			reason: 'recorded-origin'
		})
		for (const sourceId of [id(9), id(17), id(10), id(12)])
			expect(find(result, 'transactions', sourceId).outcome).toBe('blocked')
		expect(find(result, 'checkDetails', id(11)).outcome).toBe('blocked')
		expect(find(result, 'transactionTags', id(15)).outcome).toBe('blocked')
		expect(summary(result).outcome).toBe('partial')
	})
	it.each([{ currency: 'EUR', archivedAt: null }, { archivedAt: '2026-10-16T00:00:00Z' }])(
		'blocks transactions against incompatible retained accounts %j',
		async (change) => {
			const test = await previewFixture()
			test.retain('accounts', id(5), change)
			test.recordOrigin('accounts', id(5))
			const result = await preview(test.input)
			expect(find(result, 'transactions', id(9))).toMatchObject({
				outcome: 'blocked',
				reason: 'incompatible-dependency'
			})
			expect(find(result, 'accounts', id(5)).outcome).toBe('existing')
		}
	)
	it('uses retained category kind and active tag state', async () => {
		const test = await previewFixture()
		test.retain('categories', id(7), { kind: 'expense' })
		test.recordOrigin('categories', id(7))
		test.retain('tags', id(8), { archivedAt: '2026-10-16T00:00:00Z' })
		test.recordOrigin('tags', id(8))
		const result = await preview(test.input)
		expect(find(result, 'transactions', id(10))).toMatchObject({
			outcome: 'blocked',
			reason: 'incompatible-dependency'
		})
		expect(find(result, 'transactionTags', id(15))).toMatchObject({
			outcome: 'blocked',
			reason: 'incompatible-dependency'
		})
	})
	it.each(['checkDetails', 'transactions'] satisfies MergeEntity[])(
		'blocks a new check counterpart when retained %s was edited',
		async (entity) => {
			const test = await previewFixture()
			const sourceId = entity === 'checkDetails' ? id(11) : id(10)
			test.retain(
				entity,
				sourceId,
				entity === 'checkDetails'
					? { transactionId: id(99) }
					: { checkDetailsId: null, paymentMethod: 'cash' }
			)
			test.recordOrigin(entity, sourceId)
			const result = await preview(test.input)
			expect(
				find(
					result,
					entity === 'checkDetails' ? 'transactions' : 'checkDetails',
					entity === 'checkDetails' ? id(10) : id(11)
				)
			).toMatchObject({ outcome: 'blocked', reason: 'incompatible-dependency' })
		}
	)
	it('propagates blocks to closure independently of graph traversal order', async () => {
		const test = await previewFixture()
		test.retain('transactionBatches', id(13)) // Occupied ordinary ID without a receipt.
		const reversed = accountMergePreviewMachine.provide({
			actors: {
				graph: fromPromise<OutputFrom<Graph>, InputFrom<Graph>>(({ input }) => {
					const graph = mergePreviewGraph(input.observations, input.plan)
					return Promise.resolve({ ...graph, records: graph.records.toReversed() })
				})
			}
		})
		const forward = summary(await preview(test.input))
		const backward = summary(await preview(test.input, reversed))
		expect(backward.counts).toEqual(forward.counts)
		for (const row of forward.decisions)
			expect(find(backward, row.entity, row.sourceId).outcome).toBe(row.outcome)
		expect(find(backward, 'transactionTags', id(15)).outcome).toBe('blocked')
		expect(find(backward, 'checkDetails', id(11)).outcome).toBe('blocked')
	})
	it('blocks missing indexed references rather than accepting an incomplete graph', async () => {
		const test = await previewFixture()
		const machine = accountMergePreviewMachine.provide({
			actors: {
				graph: fromPromise<OutputFrom<Graph>, InputFrom<Graph>>(async ({ input }) => {
					const graph = mergePreviewGraph(input.observations, input.plan)
					const index = new Map(graph.byTarget)
					index.delete(
						mergeTargetKey('accounts', test.candidate('accounts', id(5)).mapping.destinationId)
					)
					return { ...graph, byTarget: index }
				})
			}
		})
		expect(find(await preview(test.input, machine), 'transactions', id(9))).toMatchObject({
			outcome: 'blocked',
			reason: 'unavailable-dependency'
		})
	})
	it('clears the dependency child graph and effective row after a coherent check decision', async () => {
		const test = await previewFixture()
		const result = summary(await preview(test.input))
		const graph = mergePreviewGraph(test.input, test.plan)
		const record = graph.records.find((row) => row.entity === 'checkDetails')
		if (!record) throw new Error('Missing check')
		const actor = createActor(accountMergePreviewDependencyMachine, {
			input: {
				record,
				graph,
				decisions: new Map(result.decisions.map((row) => [row.originId, row]))
			}
		}).start()
		await expect(toPromise(actor)).resolves.toEqual({
			decision: find(result, 'checkDetails', id(11))
		})
		expect(actor.getSnapshot().context).toMatchObject({
			input: undefined,
			dependencies: [],
			parents: [],
			dependency: undefined,
			effective: undefined,
			index: 0
		})
	})
	it('uses bounded witnesses even when the differing provider alias arrives last', async () => {
		const mapping = fixture()
		const provider = mapping.snapshot.transactions.find((row) => row.source === 'simplefin')
		if (!provider) throw new Error('Missing provider')
		for (let index = 0; index < 128; index++)
			mapping.snapshot.transactions.push({
				...provider,
				id: id(1000 + index),
				amountMinor: index === 127 ? 999 : provider.amountMinor
			})
		const test = await previewFixture(mapping)
		const aliases = mergePreviewGraph(test.input, test.plan).records.filter(
			(row) => row.candidate.mapping.kind === 'provider-transaction'
		)
		expect(aliases).toHaveLength(129)
		for (const record of aliases) expect(record.peers).toHaveLength(2)
		const result = summary(await preview(test.input))
		expect(
			result.decisions.filter(
				(row) => row.outcome === 'conflict' && row.reason === 'source-provider-collision'
			)
		).toHaveLength(129)
	})

	it('treats a noncanonical receipt ID for the same source tuple as a conflict', async () => {
		const test = await previewFixture()
		test.recordOrigin('accounts', id(5), { id: id(99) })
		expect(find(await preview(test.input), 'accounts', id(5))).toMatchObject({
			outcome: 'conflict',
			reason: 'invalid-provenance'
		})
	})
	it('counts receipt-only provider reuse separately from recorded origins', async () => {
		const test = await previewFixture()
		test.retain('transactions', id(12))
		test.recordOrigin('batchTemplates', id(14))
		const result = summary(await preview(test.input))
		expect(find(result, 'transactions', id(12))).toMatchObject({
			outcome: 'existing',
			reason: 'provider-identity'
		})
		expect(result.counts).toMatchObject({ newTargets: 10, existingOrigins: 3, newReceipts: 12 })
	})
})

describe('preview input validation', () => {
	it.each([
		'accounts',
		'categories',
		'tags',
		'transactions',
		'checkDetails',
		'transactionTags',
		'transactionBatches',
		'batchTemplates'
	])('requires explicit %s observations', async (entity) => {
		const { input } = await previewFixture()
		expect(
			await preview({ ...input, observations: { ...input.observations, [entity]: undefined } })
		).toEqual({ outcome: 'failed', code: 'invalid-input' })
	})
	it.each(['duplicate-target', 'foreign-target', 'duplicate-receipt', 'ambiguous-origin'])(
		'rejects %s observations',
		async (scenario) => {
			const test = await previewFixture()
			if (scenario === 'duplicate-target') {
				const row = test.retain('accounts', id(5))
				test.input.observations.accounts.targets.push({ ...row })
			}
			if (scenario === 'foreign-target') test.retain('accounts', id(5), { organizationId: id(99) })
			if (scenario === 'duplicate-receipt') {
				const row = test.recordOrigin('accounts', id(5))
				test.input.observations.accounts.receipts.push({ ...row })
			}
			if (scenario === 'ambiguous-origin') {
				test.recordOrigin('accounts', id(5))
				test.recordOrigin('accounts', id(5), { id: id(99) })
			}
			expect(await preview(test.input)).toEqual({ outcome: 'failed', code: 'invalid-input' })
		}
	)
	it('enforces the combined observation count across individually valid table arrays', async () => {
		const test = await previewFixture()
		const organizationId = test.input.mapping.destination.organizationId
		test.input.observations.batchTemplates.targets = Array.from({ length: 7000 }, (_, i) => ({
			id: id(10000 + i),
			organizationId,
			name: 'Template'
		}))
		test.input.observations.transactionBatches.targets = Array.from({ length: 7000 }, (_, i) => ({
			id: id(20000 + i),
			organizationId,
			name: null
		}))
		test.input.observations.tags.targets = Array.from({ length: 7000 }, (_, i) => ({
			id: id(30000 + i),
			organizationId,
			name: 'Tag',
			categoryId: null,
			archivedAt: null
		}))
		expect(await preview(test.input)).toEqual({ outcome: 'failed', code: 'invalid-input' })
	})
	it('rejects an input exceeding the preview byte limit without truncation', async () => {
		const test = await previewFixture()
		test.retain('batchTemplates', id(14), { name: 'x'.repeat(mergeSnapshotLimits.bytes * 3) })
		expect(await preview(test.input)).toEqual({ outcome: 'failed', code: 'invalid-input' })
	})

	it('rejects secrets and wrong-table row shapes', async () => {
		const test = await previewFixture()
		expect(
			accountMergePreviewInputSchema.safeParse({ ...test.input, recoveryPhrase: 'private' }).success
		).toBe(false)
		expect(
			accountMergePreviewInputSchema.safeParse({
				...test.input,
				observations: {
					...test.input.observations,
					accounts: { targets: [test.candidate('tags', id(8)).value], receipts: [] }
				}
			}).success
		).toBe(false)
	})
})
