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
import { mergePreviewGraph } from '#lib/account-merge/preview.js'
import type { MergeConflictInput } from '#lib/schema/account-merge-conflict.js'
import { id } from './mapping.fixtures.js'
import { accountMergeMappingMachine } from './mapping.js'
import { previewFixture } from './preview.fixtures.js'
import { accountMergePreviewMachine } from './preview.js'
import { accountMergeReferencesMachine } from './references.js'

type Graph = typeof accountMergePreviewMachine.implementations.actors.graph
type Identities = typeof accountMergeMappingMachine.implementations.actors.identities
function cleared(actor: ActorRefFrom<typeof accountMergePreviewMachine>) {
	expect(actor.getSnapshot().context).toMatchObject({
		input: undefined,
		plan: undefined,
		graph: undefined,
		decisions: new Map(),
		index: 0,
		changes: 0
	})
}

describe('preview supervision and lifecycle', () => {
	it('preserves reference-preparation domain errors', async () => {
		const { input } = await previewFixture()
		input.mapping.categories = []
		const actor = createActor(accountMergePreviewMachine, { input }).start()
		await expect(toPromise(actor)).resolves.toEqual({
			outcome: 'failed',
			code: 'missing-system-category'
		})
		cleared(actor)
	})
	it('classifies graph construction rejection without retaining private diagnostics', async () => {
		const { input } = await previewFixture()
		const machine = accountMergePreviewMachine.provide({
			actors: {
				graph: fromPromise<OutputFrom<Graph>, InputFrom<Graph>>(async () => {
					throw new Error('private graph failure')
				})
			}
		})
		const actor = createActor(machine, { input }).start()
		await expect(toPromise(actor)).resolves.toEqual({
			outcome: 'failed',
			code: 'preview-preparation-failed'
		})
		cleared(actor)
	})
	it('supervises unexpected classifier startup errors', async () => {
		const { input } = await previewFixture()
		const machine = accountMergePreviewMachine.provide({
			actors: {
				graph: fromPromise<OutputFrom<Graph>, InputFrom<Graph>>(async ({ input }) => {
					const graph = mergePreviewGraph(input.observations, input.plan)
					graph.records = graph.records.map(
						(record) =>
							new Proxy(record, {
								get(target, key, receiver) {
									if (key === 'entity') throw new Error('private classifier startup failure')
									return Reflect.get(target, key, receiver)
								}
							})
					)
					return graph
				})
			}
		})
		const actor = createActor(machine, { input }).start()
		await expect(toPromise(actor)).resolves.toEqual({
			outcome: 'failed',
			code: 'classification-failed'
		})
		cleared(actor)
	})
	it('supervises dependency child startup errors without awaiting failed children', async () => {
		const { input } = await previewFixture()
		class FailedIndex extends Map<string, readonly MergeConflictInput[]> {
			override get(_key: string): readonly MergeConflictInput[] | undefined {
				throw new Error('private dependency startup failure')
			}
		}
		const machine = accountMergePreviewMachine.provide({
			actors: {
				graph: fromPromise<OutputFrom<Graph>, InputFrom<Graph>>(async ({ input }) => {
					const graph = mergePreviewGraph(input.observations, input.plan)
					return { ...graph, byTarget: new FailedIndex() }
				})
			}
		})
		const actor = createActor(machine, { input }).start()
		await expect(toPromise(actor)).resolves.toEqual({
			outcome: 'failed',
			code: 'dependency-check-failed'
		})
		cleared(actor)
	})
	it('fails closed when a classifier returns a domain failure', async () => {
		const { input } = await previewFixture()
		const machine = accountMergePreviewMachine.provide({
			actors: {
				graph: fromPromise<OutputFrom<Graph>, InputFrom<Graph>>(async ({ input }) => {
					const graph = mergePreviewGraph(input.observations, input.plan)
					const record = graph.records[0]
					if (!record) throw new Error('Missing record')
					record.candidate.mapping.entity = 'tags'
					return graph
				})
			}
		})
		const actor = createActor(machine, { input }).start()
		await expect(toPromise(actor)).resolves.toEqual({
			outcome: 'failed',
			code: 'invalid-observation'
		})
		cleared(actor)
	})
	for (const stage of ['references', 'graph']) {
		for (const command of ['CANCEL', 'SHUTDOWN'] satisfies ('CANCEL' | 'SHUTDOWN')[]) {
			it.each(['resolve', 'reject'])(`${command} during ${stage} ignores late %s`, async (late) => {
				const { input, plan } = await previewFixture()
				const identities = Promise.withResolvers<OutputFrom<Identities>>()
				const graphPending = Promise.withResolvers<OutputFrom<Graph>>()
				const graph = vi.fn(() => graphPending.promise)
				const allocation = accountMergeMappingMachine.provide({
					actors: {
						identities: fromPromise<OutputFrom<Identities>, InputFrom<Identities>>(
							() => identities.promise
						)
					}
				})
				const references = accountMergeReferencesMachine.provide({ actors: { allocation } })
				const machine = accountMergePreviewMachine.provide({
					actors: {
						...(stage === 'references' ? { references } : {}),
						graph: fromPromise<OutputFrom<Graph>, InputFrom<Graph>>(graph)
					}
				})
				const actor = createActor(machine, { input }).start()
				await waitFor(actor, (snapshot) =>
					snapshot.matches(stage === 'references' ? 'preparing' : 'buildingGraph')
				)
				actor.send({ type: command })
				const output = { outcome: command === 'CANCEL' ? 'cancelled' : 'closed' }
				await expect(toPromise(actor)).resolves.toEqual(output)
				if (stage === 'references') {
					if (late === 'resolve') identities.resolve({ destinationId: id(90), originId: id(91) })
					else identities.reject(new Error('private late digest failure'))
					await identities.promise.catch(() => undefined)
				} else {
					if (late === 'resolve') graphPending.resolve(mergePreviewGraph(input, plan))
					else graphPending.reject(new Error('private late graph failure'))
					await graphPending.promise.catch(() => undefined)
				}
				await Promise.resolve()
				expect(actor.getSnapshot().output).toEqual(output)
				expect(graph).toHaveBeenCalledTimes(stage === 'references' ? 0 : 1)
				cleared(actor)
			})
		}
	}
	for (const stage of ['classifying', 'checkingDependency'] satisfies (
		'classifying' | 'checkingDependency'
	)[]) {
		it.each(['CANCEL', 'SHUTDOWN'] satisfies ('CANCEL' | 'SHUTDOWN')[])(
			`%s while traversing ${stage} takes precedence over remaining results`,
			async (command) => {
				const { input } = await previewFixture()
				const actor = createActor(accountMergePreviewMachine, { input })
				let sent = false
				actor.subscribe((snapshot) => {
					if (!sent && snapshot.matches(stage)) {
						sent = true
						actor.send({ type: command })
					}
				})
				actor.start()
				await expect(toPromise(actor)).resolves.toEqual({
					outcome: command === 'CANCEL' ? 'cancelled' : 'closed'
				})
				expect(sent).toBe(true)
				cleared(actor)
			}
		)
	}
})
