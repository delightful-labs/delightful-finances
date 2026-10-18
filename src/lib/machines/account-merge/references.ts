import { assign, fromPromise, setup } from 'xstate'
import { mergeReferencePlan } from '#lib/account-merge/references.js'
import type {
	AccountMergeMappingInput,
	MergeMappingResult
} from '#lib/schema/account-merge-mapping.js'
import type { MergeReferenceResult } from '#lib/schema/account-merge-references.js'
import { accountMergeMappingInputSchema } from '#lib/validation/account-merge-mapping.js'
import { required } from '../bank-sync/identity.js'
import { accountMergeMappingMachine } from './mapping.js'

type Allocation = Extract<MergeMappingResult, { outcome: 'mapped' }>
type Context = {
	input: AccountMergeMappingInput | undefined
	allocation: Allocation | undefined
	result: MergeReferenceResult | undefined
}
type Event = { type: 'CANCEL' | 'SHUTDOWN' }
const actors = {
	allocation: accountMergeMappingMachine,
	references: fromPromise(
		({
			input
		}: {
			input: { snapshot: AccountMergeMappingInput['snapshot']; allocation: Allocation }
		}) => Promise.resolve(mergeReferencePlan(input.snapshot, input.allocation))
	)
}
const workflow = setup<
	Context,
	Event,
	typeof actors,
	{},
	{},
	{},
	never,
	string,
	unknown,
	MergeReferenceResult
>({ actors })
const clear = workflow.assign({ input: undefined, allocation: undefined })
const finish = workflow.createStateConfig({ type: 'final', entry: clear })

// This child owns preparation only. Its owner must establish destination readiness,
// observe permission/scope changes, and cancel stale work before consuming the plan.
export const accountMergeReferencesMachine = workflow.createMachine({
	id: 'account-merge-references',
	initial: 'validating',
	context: ({ input }) => {
		const parsed = accountMergeMappingInputSchema.safeParse(input)
		return {
			input: parsed.success ? parsed.data : undefined,
			allocation: undefined,
			result: undefined
		}
	},
	output: ({ context }) => required(context.result),
	on: {
		CANCEL: {
			target: '.cancelled',
			actions: assign({ result: { outcome: 'cancelled' } })
		},
		SHUTDOWN: { target: '.closed', actions: assign({ result: { outcome: 'closed' } }) }
	},
	states: {
		validating: {
			always: [
				{
					guard: ({ context }) => !context.input,
					target: 'failed',
					actions: assign({ result: { outcome: 'failed', code: 'invalid-input' } })
				},
				{ target: 'allocating' }
			]
		},
		allocating: {
			invoke: {
				src: 'allocation',
				input: ({ context }: { context: Context }) => required(context.input),
				onDone: [
					{
						guard: ({ event }) => event.output.outcome === 'mapped',
						target: 'rewriting',
						actions: assign({
							allocation: ({ event }) =>
								event.output.outcome === 'mapped' ? event.output : undefined
						})
					},
					{
						guard: ({ event }) => event.output.outcome === 'failed',
						target: 'failed',
						actions: assign({
							result: ({ event }) =>
								event.output.outcome === 'failed'
									? event.output
									: { outcome: 'failed', code: 'reference-mapping-failed' }
						})
					},
					{
						guard: ({ event }) => event.output.outcome === 'closed',
						target: 'closed',
						actions: assign({ result: { outcome: 'closed' } })
					},
					{ target: 'cancelled', actions: assign({ result: { outcome: 'cancelled' } }) }
				],
				onError: {
					target: 'failed',
					actions: assign({
						result: { outcome: 'failed', code: 'identity-allocation-failed' }
					})
				}
			}
		},
		rewriting: {
			invoke: {
				src: 'references',
				input: ({ context }) => ({
					snapshot: required(context.input).snapshot,
					allocation: required(context.allocation)
				}),
				onDone: {
					target: 'prepared',
					actions: assign({
						result: ({ event }) => ({ outcome: 'prepared', plan: event.output })
					})
				},
				onError: {
					target: 'failed',
					actions: assign({
						result: { outcome: 'failed', code: 'reference-mapping-failed' }
					})
				}
			}
		},
		prepared: finish,
		failed: finish,
		cancelled: finish,
		closed: finish
	}
})
