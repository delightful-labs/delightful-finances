import { setup, type EventObject } from 'xstate'
import {
	matchingMergeReceipt,
	reusableMergeSystemCategory,
	sameMergeValues,
	validMergeObservation
} from '#lib/account-merge/conflict.js'
import type {
	MergeConflictInput,
	MergeDecisionOutcome,
	MergeConflictResult
} from '#lib/schema/account-merge-conflict.js'
import { accountMergeConflictInputSchema } from '#lib/validation/account-merge-conflict.js'
import { required } from '../bank-sync/identity.js'

type Context = { input: MergeConflictInput | undefined; result: MergeConflictResult | undefined }
type Event = EventObject
const workflow = setup<Context, Event, {}, {}, {}, {}, never, string, unknown, MergeConflictResult>(
	{}
)
const clear = workflow.assign({ input: undefined })
const finish = (result: (input: MergeConflictInput) => MergeConflictResult) =>
	workflow.createStateConfig({
		type: 'final',
		entry: [workflow.assign({ result: ({ context }) => result(required(context.input)) }), clear]
	})
const classified = (outcome: MergeDecisionOutcome) =>
	finish((input) => ({
		outcome: 'classified',
		decision: {
			entity: input.entity,
			sourceId: input.candidate.mapping.sourceId,
			destinationId: input.candidate.mapping.destinationId,
			originId: input.candidate.mapping.originId,
			...outcome
		}
	}))
const failed = (code: 'invalid-input' | 'invalid-observation') =>
	workflow.createStateConfig({
		type: 'final',
		entry: [workflow.assign({ result: { outcome: 'failed', code } }), clear]
	})

// Synchronous guarded classification over validated observations. The graph owner
// must still resolve dependencies, permission changes and concurrent writes.
export const accountMergeConflictMachine = workflow.createMachine({
	id: 'account-merge-conflict',
	initial: 'validating',
	context: ({ input }) => {
		const parsed = accountMergeConflictInputSchema.safeParse(input)
		return { input: parsed.success ? parsed.data : undefined, result: undefined }
	},
	output: ({ context }) => required(context.result),
	states: {
		validating: {
			always: [
				{ guard: ({ context }) => !context.input, target: 'invalidInput' },
				{
					guard: ({ context }) => !validMergeObservation(required(context.input)),
					target: 'invalidObservation'
				},
				{ target: 'checkingReceipt' }
			]
		},
		checkingReceipt: {
			always: [
				{
					guard: ({ context }) => matchingMergeReceipt(required(context.input)),
					target: 'recorded'
				},
				{
					guard: ({ context }) => required(context.input).receipt !== null,
					target: 'invalidProvenance'
				},
				{ target: 'routingKind' }
			]
		},
		routingKind: {
			always: [
				{
					guard: ({ context }) =>
						required(context.input).candidate.mapping.kind === 'system-category',
					target: 'checkingSystemCategory'
				},
				{
					guard: ({ context }) =>
						required(context.input).candidate.mapping.kind === 'provider-transaction',
					target: 'checkingProviderPeers'
				},
				{ target: 'checkingOrdinaryTarget' }
			]
		},
		checkingSystemCategory: {
			always: [
				{
					guard: ({ context }) => required(context.input).target === null,
					target: 'missingSystemCategory'
				},
				{
					guard: ({ context }) => reusableMergeSystemCategory(required(context.input)),
					target: 'reusedCategory'
				},
				{ target: 'invalidSystemCategory' }
			]
		},
		checkingProviderPeers: {
			always: [
				{
					guard: ({ context }) => {
						const input = required(context.input)
						return input.peers.some((peer) => !sameMergeValues(input.candidate.value, peer))
					},
					target: 'sourceProviderCollision'
				},
				{ target: 'checkingProviderTarget' }
			]
		},
		checkingProviderTarget: {
			always: [
				{ guard: ({ context }) => required(context.input).target === null, target: 'addition' },
				{
					guard: ({ context }) => {
						const input = required(context.input)
						return sameMergeValues(input.candidate.value, required(input.target ?? undefined))
					},
					target: 'reusedProvider'
				},
				{ target: 'providerValues' }
			]
		},
		checkingOrdinaryTarget: {
			always: [
				{ guard: ({ context }) => required(context.input).target === null, target: 'addition' },
				{ target: 'destinationCollision' }
			]
		},
		addition: classified({ outcome: 'addition' }),
		recorded: classified({ outcome: 'existing', reason: 'recorded-origin' }),
		reusedCategory: classified({ outcome: 'existing', reason: 'system-category' }),
		reusedProvider: classified({ outcome: 'existing', reason: 'provider-identity' }),
		invalidProvenance: classified({ outcome: 'conflict', reason: 'invalid-provenance' }),
		missingSystemCategory: classified({ outcome: 'conflict', reason: 'missing-system-category' }),
		invalidSystemCategory: classified({ outcome: 'conflict', reason: 'invalid-system-category' }),
		sourceProviderCollision: classified({
			outcome: 'conflict',
			reason: 'source-provider-collision'
		}),
		providerValues: classified({ outcome: 'conflict', reason: 'provider-values' }),
		destinationCollision: classified({ outcome: 'conflict', reason: 'destination-collision' }),
		invalidInput: failed('invalid-input'),
		invalidObservation: failed('invalid-observation')
	}
})
