import { assign, fromPromise, setup } from 'xstate'
import { mergePreviewGraph, mergePreviewSummary } from '#lib/account-merge/preview.js'
import type { MergeReferencePlan } from '#lib/schema/account-merge-references.js'
import type {
	MergePreviewDecision,
	MergePreviewGraph,
	MergePreviewInput,
	MergePreviewResult
} from '#lib/schema/account-merge-preview.js'
import { accountMergePreviewInputSchema } from '#lib/validation/account-merge-preview.js'
import { required } from '../bank-sync/identity.js'
import { accountMergePreparationMachine } from './preparation.js'
import { accountMergeConflictMachine } from './conflict.js'
import { accountMergePreviewDependencyMachine } from './preview-dependency.js'

type Failure = Extract<MergePreviewResult, { outcome: 'failed' }>['code']
type Context = {
	input: MergePreviewInput | undefined
	plan: MergeReferencePlan | undefined
	graph: MergePreviewGraph | undefined
	index: number
	decisions: Map<string, MergePreviewDecision>
	changes: number
	error: Failure
	result: MergePreviewResult | undefined
}
type Event = { type: 'CANCEL' | 'SHUTDOWN' }
const actors = {
	preparation: accountMergePreparationMachine,
	graph: fromPromise(
		({ input }: { input: { observations: MergePreviewInput; plan: MergeReferencePlan } }) =>
			Promise.resolve(mergePreviewGraph(input.observations, input.plan))
	),
	classify: accountMergeConflictMachine,
	dependency: accountMergePreviewDependencyMachine
}
const workflow = setup<
	Context,
	Event,
	typeof actors,
	{},
	{ fail: { code: Failure } },
	{},
	never,
	string,
	unknown,
	MergePreviewResult
>({
	actors,
	actions: { fail: assign((_, params: { code: Failure }) => ({ error: params.code })) }
})
const clear = workflow.assign({
	input: undefined,
	plan: undefined,
	graph: undefined,
	index: 0,
	decisions: new Map<string, MergePreviewDecision>(),
	changes: 0
})
const finish = (result: (context: Context) => MergePreviewResult) =>
	workflow.createStateConfig({
		type: 'final',
		entry: [workflow.assign({ result: ({ context }) => result(context) }), clear]
	})
const failure = (code: Failure): { type: 'fail'; params: { code: Failure } } => ({
	type: 'fail',
	params: { code }
})
const summary = (context: Context) =>
	mergePreviewSummary(
		[...context.decisions.values()],
		required(context.input).mapping.snapshot.excludedConnectionCount
	)

// Advisory preview only. Its integration owner must establish observations and
// cancel/rebuild on identity, scope or permission changes. Writes require rechecks.
export const accountMergePreviewMachine = workflow.createMachine({
	id: 'account-merge-preview',
	initial: 'validating',
	context: ({ input }) => {
		const parsed = accountMergePreviewInputSchema.safeParse(input)
		return {
			input: parsed.success ? parsed.data : undefined,
			plan: undefined,
			graph: undefined,
			index: 0,
			decisions: new Map<string, MergePreviewDecision>(),
			changes: 0,
			error: 'invalid-input',
			result: undefined
		}
	},
	output: ({ context }) => required(context.result),
	on: { CANCEL: '.cancelled', SHUTDOWN: '.closed' },
	states: {
		validating: {
			always: [
				{ guard: ({ context }) => !context.input, target: 'failed' },
				{ target: 'preparing' }
			]
		},
		preparing: {
			invoke: {
				src: 'preparation',
				input: ({ context }: { context: Context }) => required(context.input).mapping,
				onDone: [
					{
						guard: ({ event }) => event.output.outcome === 'prepared',
						target: 'buildingGraph',
						actions: assign({
							plan: ({ event }) =>
								event.output.outcome === 'prepared' ? event.output.plan : undefined
						})
					},
					{
						guard: ({ event }) => event.output.outcome === 'failed',
						target: 'failed',
						actions: assign({
							error: ({ event }) =>
								event.output.outcome === 'failed' ? event.output.code : 'preview-preparation-failed'
						})
					},
					{ guard: ({ event }) => event.output.outcome === 'closed', target: 'closed' },
					{ target: 'cancelled' }
				],
				onError: { target: 'failed', actions: failure('preview-preparation-failed') }
			}
		},
		buildingGraph: {
			invoke: {
				src: 'graph',
				input: ({ context }) => ({
					observations: required(context.input),
					plan: required(context.plan)
				}),
				onDone: {
					target: 'nextClassification',
					actions: assign({ graph: ({ event }) => event.output, plan: undefined })
				},
				onError: { target: 'failed', actions: failure('preview-preparation-failed') }
			}
		},
		nextClassification: {
			always: [
				{
					guard: ({ context }) => context.index >= required(context.graph).records.length,
					target: 'startingDependencyPass'
				},
				{ target: 'classifying' }
			]
		},
		classifying: {
			invoke: {
				src: 'classify',
				input: ({ context }: { context: Context }) =>
					required(required(context.graph).records[context.index]),
				onDone: [
					{
						guard: ({ event }) => event.output.outcome === 'classified',
						target: 'nextClassification',
						actions: assign({
							decisions: ({ context, event }) => {
								const decisions = new Map(context.decisions)
								if (event.output.outcome === 'classified')
									decisions.set(event.output.decision.originId, event.output.decision)
								return decisions
							},
							index: ({ context }) => context.index + 1
						})
					},
					{ target: 'failed', actions: failure('invalid-observation') }
				],
				onError: { target: 'failed', actions: failure('classification-failed') }
			}
		},
		startingDependencyPass: {
			entry: workflow.assign({ index: 0, changes: 0 }),
			always: 'nextDependency'
		},
		nextDependency: {
			always: [
				{
					guard: ({ context }) => context.index >= required(context.graph).records.length,
					target: 'checkingPass'
				},
				{ target: 'checkingDependency' }
			]
		},
		checkingDependency: {
			invoke: {
				src: 'dependency',
				input: ({ context }) => ({
					record: required(required(context.graph).records[context.index]),
					graph: required(context.graph),
					decisions: context.decisions
				}),
				onDone: {
					target: 'nextDependency',
					actions: assign({
						decisions: ({ context, event }) =>
							new Map(context.decisions).set(event.output.decision.originId, event.output.decision),
						changes: ({ context, event }) =>
							context.changes +
							(context.decisions.get(event.output.decision.originId)?.outcome !==
							event.output.decision.outcome
								? 1
								: 0),
						index: ({ context }) => context.index + 1
					})
				},
				onError: { target: 'failed', actions: failure('dependency-check-failed') }
			}
		},
		checkingPass: {
			always: [
				{ guard: ({ context }) => context.changes > 0, target: 'startingDependencyPass' },
				{
					guard: ({ context }) =>
						[...context.decisions.values()].some(
							(row) => row.outcome === 'conflict' || row.outcome === 'blocked'
						),
					target: 'partial'
				},
				{ target: 'previewed' }
			]
		},
		previewed: finish((context) => ({ outcome: 'previewed', ...summary(context) })),
		partial: finish((context) => ({ outcome: 'partial', ...summary(context) })),
		failed: finish((context) => ({ outcome: 'failed', code: context.error })),
		cancelled: finish(() => ({ outcome: 'cancelled' })),
		closed: finish(() => ({ outcome: 'closed' }))
	}
})
