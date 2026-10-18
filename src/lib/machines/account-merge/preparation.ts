import { assign, fromPromise, setup } from 'xstate'
import { mergeReferencePlan } from '#lib/account-merge/references.js'
import type {
	MergeReferencePlan,
	MergeReferenceResult
} from '#lib/schema/account-merge-references.js'
import type { MergeAllocation } from '#lib/schema/account-merge-mapping.js'
import { stableUuid } from '#lib/data.js'
import type {
	AccountMergeMappingInput,
	MergeRecordMapping
} from '#lib/schema/account-merge-mapping.js'
import { accountMergeMappingInputSchema } from '#lib/validation/account-merge-mapping.js'
import {
	mergeMappingRecords,
	mergeOriginIdentityName,
	mergeRecordIdentityName,
	mergeRecordMapping,
	type MergeMappingRecord
} from '#lib/account-merge/mapping.js'
import { required } from '../bank-sync/identity.js'

type PreparationError = Extract<MergeReferenceResult, { outcome: 'failed' }>['code']
type Category = AccountMergeMappingInput['categories'][number]
type Context = {
	input: AccountMergeMappingInput | undefined
	records: MergeMappingRecord[]
	index: number
	categories: Category[]
	mappings: MergeRecordMapping[]
	plan: MergeReferencePlan | undefined
	error: PreparationError
	result: MergeReferenceResult | undefined
}
type Event = { type: 'CANCEL' | 'SHUTDOWN' }
type IdentityInput = { namespace: string; name: string; originName: string }

const actors = {
	references: fromPromise(
		({
			input
		}: {
			input: { snapshot: AccountMergeMappingInput['snapshot']; allocation: MergeAllocation }
		}) => Promise.resolve(mergeReferencePlan(input.snapshot, input.allocation))
	),
	identities: fromPromise(async ({ input }: { input: IdentityInput }) => {
		const [destinationId, originId] = await Promise.all([
			stableUuid(input.namespace, input.name),
			stableUuid(input.namespace, input.originName)
		])
		return { destinationId, originId }
	}),
	receipt: fromPromise(({ input }: { input: { namespace: string; name: string } }) =>
		stableUuid(input.namespace, input.name)
	)
}
const workflow = setup<
	Context,
	Event,
	typeof actors,
	{},
	{ fail: { code: PreparationError } },
	{},
	never,
	string,
	unknown,
	MergeReferenceResult
>({
	actors,
	actions: {
		fail: assign((_, params: { code: PreparationError }) => ({ error: params.code }))
	}
})
const clear = workflow.assign({
	input: undefined,
	records: [],
	categories: [],
	mappings: [],
	index: 0,
	plan: undefined
})
const failure = (code: PreparationError): { type: 'fail'; params: { code: PreparationError } } => ({
	type: 'fail',
	params: { code }
})
const finish = (result: (context: Context) => MergeReferenceResult) =>
	workflow.createStateConfig({
		type: 'final',
		entry: [workflow.assign({ result: ({ context }) => result(context) }), clear]
	})
const allocating = (kind: 'origin' | 'provider-transaction', name: (context: Context) => string) =>
	workflow.createStateConfig({
		invoke: {
			src: 'identities',
			input: ({ context }) => ({
				namespace: required(context.input).destination.organizationId,
				name: name(context),
				originName: mergeOriginIdentityName(
					required(context.input),
					required(context.records[context.index])
				)
			}),
			onDone: {
				target: 'advance',
				actions: assign({
					mappings: ({ context, event }) => [
						...context.mappings,
						mergeRecordMapping(required(context.records[context.index]), kind, event.output)
					]
				})
			},
			onError: { target: 'failed', actions: failure('identity-allocation-failed') }
		}
	})

// Prepare new IDs and rewrite references in one lifecycle. Destination authorization,
// collision decisions and writes remain the responsibility of preview/import owners.
export const accountMergePreparationMachine = workflow.createMachine({
	id: 'account-merge-preparation',
	initial: 'validating',
	context: ({ input }) => {
		const parsed = accountMergeMappingInputSchema.safeParse(input)
		return {
			input: parsed.success ? parsed.data : undefined,
			records: [],
			index: 0,
			categories: [],
			mappings: [],
			plan: undefined,
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
				{ target: 'checkingIdentity' }
			]
		},
		checkingIdentity: {
			always: [
				{
					guard: ({ context }) =>
						required(context.input).destination.identityId ===
						required(context.input).snapshot.sourceIdentityId,
					target: 'failed',
					actions: failure('same-identity')
				},
				{ target: 'checkingWorkspace' }
			]
		},
		checkingWorkspace: {
			always: [
				{
					guard: ({ context }) =>
						required(context.input).destination.organizationId ===
						required(context.input).snapshot.sourceOrganization.id,
					target: 'failed',
					actions: failure('same-workspace')
				},
				{ target: 'checkingCategories' }
			]
		},
		checkingCategories: {
			always: [
				{
					guard: ({ context }) => {
						const input = required(context.input)
						return (
							input.categories.some(
								(category) => category.organizationId !== input.destination.organizationId
							) ||
							new Set(input.categories.map((category) => category.id)).size !==
								input.categories.length
						)
					},
					target: 'failed',
					actions: failure('invalid-destination-categories')
				},
				{
					target: 'nextRecord',
					actions: workflow.assign({
						records: ({ context }) => mergeMappingRecords(required(context.input))
					})
				}
			]
		},
		nextRecord: {
			always: [
				{ guard: ({ context }) => context.index >= context.records.length, target: 'rewriting' },
				{ target: 'routingRecord' }
			]
		},
		routingRecord: {
			always: [
				{
					guard: ({ context }) => {
						const record = required(context.records[context.index])
						return record.entity === 'categories' && record.isSystem
					},
					target: 'matchingSystemCategory'
				},
				{
					guard: ({ context }) => {
						const record = required(context.records[context.index])
						return record.entity === 'transactions' && record.source === 'simplefin'
					},
					target: 'allocatingProviderIdentity'
				},
				{ target: 'allocatingOriginIdentity' }
			]
		},
		matchingSystemCategory: {
			entry: workflow.assign({
				categories: ({ context }) => {
					const record = required(context.records[context.index])
					return required(context.input).categories.filter(
						(category) =>
							record.entity === 'categories' &&
							category.kind === record.kind &&
							category.isSystem &&
							category.archivedAt === null
					)
				}
			}),
			always: [
				{
					guard: ({ context }) => context.categories.length === 0,
					target: 'failed',
					actions: failure('missing-system-category')
				},
				{
					guard: ({ context }) => context.categories.length > 1,
					target: 'failed',
					actions: failure('ambiguous-system-category')
				},
				{ target: 'allocatingSystemOrigin' }
			]
		},
		allocatingSystemOrigin: {
			invoke: {
				src: 'receipt',
				input: ({ context }) => ({
					namespace: required(context.input).destination.organizationId,
					name: mergeOriginIdentityName(
						required(context.input),
						required(context.records[context.index])
					)
				}),
				onDone: {
					target: 'advance',
					actions: assign({
						mappings: ({ context, event }) => {
							const record = required(context.records[context.index])
							return [
								...context.mappings,
								{
									kind: 'system-category',
									entity: 'categories',
									sourceId: record.sourceId,
									destinationId: required(context.categories[0]).id,
									originId: event.output
								}
							]
						}
					})
				},
				onError: { target: 'failed', actions: failure('identity-allocation-failed') }
			}
		},
		allocatingProviderIdentity: allocating('provider-transaction', (context) => {
			const record = required(context.records[context.index])
			return `simplefin-transaction:${required(record.entity === 'transactions' ? record.externalId : undefined)}`
		}),
		allocatingOriginIdentity: allocating('origin', (context) =>
			mergeRecordIdentityName(required(context.input), required(context.records[context.index]))
		),
		advance: {
			entry: workflow.assign({ index: ({ context }) => context.index + 1, categories: [] }),
			always: 'nextRecord'
		},
		rewriting: {
			invoke: {
				src: 'references',
				input: ({ context }) => ({
					snapshot: required(context.input).snapshot,
					allocation: {
						destination: required(context.input).destination,
						records: context.mappings
					}
				}),
				onDone: { target: 'prepared', actions: assign({ plan: ({ event }) => event.output }) },
				onError: { target: 'failed', actions: failure('reference-mapping-failed') }
			}
		},
		prepared: finish((context) => ({ outcome: 'prepared', plan: required(context.plan) })),

		failed: finish((context) => ({ outcome: 'failed', code: context.error })),
		cancelled: finish(() => ({ outcome: 'cancelled' })),
		closed: finish(() => ({ outcome: 'closed' }))
	}
})
