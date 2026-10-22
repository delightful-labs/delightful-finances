import { assign, fromPromise, setup, stateIn } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import type { Organization } from '../schema.js'
import { workspaceNameFormSchema } from '../validation/identity.js'
import { prepareWorkspaceCreation } from '../domain/workspace-creation.js'
import {
	workspaceCreationJournal,
	type JournalResult,
	type WorkspaceJournalRecord
} from './workspace-creation-journal.js'
import {
	workspaceCreationReconciliation,
	type ReconciliationResult
} from './workspace-creation-reconciliation.js'
import { persistWorkspaceCreation } from './workspace-creation-persistence.js'
import type { WorkspacePersistenceResult } from './workspace-creation-transaction.js'
export type CreationBinding = { key: string; userId: string; profileId: string }
export type CreationRequest =
	| { mode: 'load' }
	| { mode: 'create'; name: string }
	| { mode: 'retry' | 'clear'; record: WorkspaceJournalRecord }
export type CreationResult = {
	outcome:
		| 'editing'
		| 'invalid'
		| 'recovered'
		| 'complete'
		| 'conflict'
		| 'failed'
		| 'unresolved'
		| 'cancelled'
		| 'closed'
	record: WorkspaceJournalRecord | undefined
	workspace: Organization | undefined
	settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
	error: unknown
}
type Db = Pick<ReturnType<typeof getDb>, 'all' | 'beginTransaction'>
type Input = { db: Db; binding: CreationBinding; request: CreationRequest }
type Event = { type: 'CANCEL' | 'SHUTDOWN' }
const validate = fromPromise(({ input }: { input: string }) =>
	Promise.resolve(workspaceNameFormSchema.parse({ name: input }).name)
)
const prepare = fromPromise(
	async ({
		input
	}: {
		input: { binding: CreationBinding; name: string }
	}): Promise<WorkspaceJournalRecord> => ({
		key: input.binding.key,
		attempt: await prepareWorkspaceCreation({
			organizationId: crypto.randomUUID(),
			userId: input.binding.userId,
			profileId: input.binding.profileId,
			name: input.name
		})
	})
)
type Context = Input & {
	name: string
	record: WorkspaceJournalRecord | undefined
	journal: JournalResult | undefined
	reconciliation: ReconciliationResult | undefined
	persistence: WorkspacePersistenceResult | undefined
	result: CreationResult
}
const empty: CreationResult = {
	outcome: 'editing',
	record: undefined,
	workspace: undefined,
	settlement: 'notStarted',
	error: undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing creation operation value')
	return value
}
const actors = {
	validate,
	prepare,
	journal: workspaceCreationJournal,
	reconcile: workspaceCreationReconciliation,
	persist: persistWorkspaceCreation
}
const model = setup<
	Context,
	Event,
	typeof actors,
	{},
	{},
	{ closing: undefined; cancelling: undefined },
	never,
	string,
	Input,
	CreationResult
>({
	actors,
	guards: {
		closing: stateIn({ running: { control: 'closing' } }),
		cancelling: stateIn({ running: { control: 'cancelling' } })
	}
})
const forward = (type: Event['type']) =>
	model.enqueueActions(({ self, enqueue }) => {
		const effect = self.getSnapshot().children.effect
		if (effect?.getSnapshot().status === 'active') enqueue.sendTo(effect, { type })
	})
const checkpoint = (
	target: string
): ({ guard: 'closing' | 'cancelling'; target: string } | { target: string })[] => [
	{ guard: 'closing', target: 'finishing' },
	{ guard: 'cancelling', target: 'finishing' },
	{ target }
]
export const workspaceCreationOperation = model.createMachine({
	id: 'workspace-creation-operation',
	initial: 'running',
	context: ({ input }) => ({
		...input,
		name: '',
		record: 'record' in input.request ? input.request.record : undefined,
		journal: undefined,
		reconciliation: undefined,
		persistence: undefined,
		result: { ...empty }
	}),
	output: ({ context }) => ({ ...context.result, record: context.record }),
	states: {
		running: {
			type: 'parallel',
			states: {
				control: {
					initial: 'active',
					states: {
						active: {
							on: {
								CANCEL: { target: 'cancelling', actions: forward('CANCEL') },
								SHUTDOWN: { target: 'closing', actions: forward('SHUTDOWN') }
							}
						},
						cancelling: {
							on: { CANCEL: {}, SHUTDOWN: { target: 'closing', actions: forward('SHUTDOWN') } }
						},
						closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
					}
				},
				work: {
					initial: 'dispatching',
					states: {
						dispatching: {
							always: [
								{
									guard: ({ context }) => context.request.mode === 'load',
									target: 'readingJournal'
								},
								{
									guard: ({ context }) => context.request.mode === 'clear',
									target: 'clearingJournal'
								},
								{
									guard: ({ context }) => context.request.mode === 'retry',
									target: 'checkingBinding'
								},
								{ target: 'validating' }
							]
						},
						validating: {
							invoke: {
								src: 'validate',
								input: ({ context }) =>
									context.request.mode === 'create' ? context.request.name : '',
								onDone: {
									target: 'checkingName',
									actions: assign({ name: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
									actions: assign({ result: { ...empty, outcome: 'invalid' } })
								}
							}
						},
						checkingName: { always: checkpoint('preparing') },
						preparing: {
							invoke: {
								src: 'prepare',
								input: ({ context }) => ({ binding: context.binding, name: context.name }),
								onDone: {
									target: 'checkingBinding',
									actions: assign({ record: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ context, event }): CreationResult => ({
											...context.result,
											outcome: 'failed',
											error: event.error
										})
									})
								}
							}
						},
						checkingBinding: {
							always: [
								{ guard: 'closing', target: 'finishing' },
								{ guard: 'cancelling', target: 'finishing' },
								{
									guard: ({ context }) =>
										context.record?.key === context.binding.key &&
										context.record.attempt.profileId === context.binding.profileId &&
										context.record.attempt.workspace.ownerId === context.binding.userId,
									target: 'recordingJournal'
								},
								{
									target: 'finishing',
									actions: assign({ result: { ...empty, outcome: 'conflict' } })
								}
							]
						},
						readingJournal: {
							invoke: {
								id: 'effect',
								src: 'journal',
								input: ({ context }) => ({ key: context.binding.key, mode: 'read' }),
								onDone: {
									target: 'checkingLoadedJournal',
									actions: assign({ journal: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ context, event }): CreationResult => ({
											...context.result,
											outcome: 'failed',
											error: event.error
										})
									})
								}
							}
						},
						checkingLoadedJournal: {
							always: [
								{ guard: 'closing', target: 'finishing' },
								{ guard: 'cancelling', target: 'finishing' },
								{
									guard: ({ context }) =>
										context.journal?.outcome === 'succeeded' &&
										context.journal.record === undefined,
									target: 'finishing'
								},
								{
									guard: ({ context }) =>
										context.journal?.outcome === 'succeeded' &&
										context.journal.record !== undefined,
									target: 'checkingLoadedBinding',
									actions: assign({
										record: ({ context }) =>
											context.journal?.outcome === 'succeeded' ? context.journal.record : undefined
									})
								},
								{ target: 'journalFailure' }
							]
						},
						checkingLoadedBinding: {
							always: [
								{
									guard: ({ context }) =>
										context.record?.key === context.binding.key &&
										context.record.attempt.workspace.ownerId === context.binding.userId &&
										context.record.attempt.profileId === context.binding.profileId,
									target: 'reconciling'
								},
								{
									target: 'finishing',
									actions: assign({ result: { ...empty, outcome: 'conflict' } })
								}
							]
						},
						recordingJournal: {
							invoke: {
								id: 'effect',
								src: 'journal',
								input: ({ context }) => ({
									key: context.binding.key,
									mode: 'write',
									record: required(context.record)
								}),
								onDone: {
									target: 'checkingRecordedJournal',
									actions: assign({ journal: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ context, event }): CreationResult => ({
											...context.result,
											outcome: 'failed',
											error: event.error
										})
									})
								}
							}
						},
						checkingRecordedJournal: {
							always: checkpoint('checkingRecordedOutcome')
						},
						checkingRecordedOutcome: {
							always: [
								{
									guard: ({ context }) => context.journal?.outcome === 'succeeded',
									target: 'reconciling'
								},
								{ target: 'journalFailure' }
							]
						},
						clearingJournal: {
							invoke: {
								id: 'effect',
								src: 'journal',
								input: ({ context }) => ({
									key: context.binding.key,
									mode: 'clear',
									organizationId: required(context.record).attempt.organizationId
								}),
								onDone: {
									target: 'checkingClearedJournal',
									actions: assign({ journal: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ context, event }): CreationResult => ({
											...context.result,
											outcome: 'failed',
											error: event.error
										})
									})
								}
							}
						},
						checkingClearedJournal: {
							always: [
								{ guard: 'closing', target: 'finishing' },
								{ guard: 'cancelling', target: 'finishing' },
								{
									guard: ({ context }) => context.journal?.outcome === 'succeeded',
									target: 'finishing',
									actions: assign({ record: undefined })
								},
								{ target: 'journalFailure' }
							]
						},
						journalFailure: {
							always: [
								{
									guard: ({ context }) => context.journal?.outcome === 'conflict',
									target: 'finishing',
									actions: assign({ result: { ...empty, outcome: 'conflict' } })
								},
								{
									target: 'finishing',
									actions: assign({
										result: ({ context }): CreationResult => ({
											...empty,
											outcome: 'failed',
											error:
												context.journal?.outcome === 'failed'
													? context.journal.error
													: new Error('Journal was interrupted')
										})
									})
								}
							]
						},
						reconciling: {
							invoke: {
								src: 'reconcile',
								input: ({ context }) => ({
									db: context.db,
									attempt: required(context.record).attempt
								}),
								onDone: {
									target: 'checkingReconciliation',
									actions: assign({ reconciliation: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ context, event }): CreationResult => ({
											...context.result,
											outcome: 'failed',
											error: event.error
										})
									})
								}
							}
						},
						checkingReconciliation: {
							always: [
								{ guard: 'closing', target: 'finishing' },
								{ guard: 'cancelling', target: 'finishing' },
								{
									guard: ({ context }) => context.reconciliation?.outcome === 'matching',
									target: 'finishing',
									actions: assign({
										result: ({ context }): CreationResult => ({
											...empty,
											outcome: 'complete',
											settlement: 'locallyPersisted',
											workspace:
												context.reconciliation?.outcome === 'matching'
													? context.reconciliation.workspace
													: undefined
										})
									})
								},
								{
									guard: ({ context }) =>
										context.reconciliation?.outcome === 'absent' && context.request.mode === 'load',
									target: 'finishing',
									actions: assign({ result: { ...empty, outcome: 'recovered' } })
								},
								{
									guard: ({ context }) => context.reconciliation?.outcome === 'absent',
									target: 'persisting'
								},
								{
									target: 'finishing',
									actions: assign({ result: { ...empty, outcome: 'conflict' } })
								}
							]
						},
						persisting: {
							invoke: {
								id: 'effect',
								src: 'persist',
								input: ({ context }) => ({
									db: context.db,
									attempt: required(context.record).attempt
								}),
								onDone: {
									target: 'checkingPersistence',
									actions: assign({ persistence: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): CreationResult => ({
											...empty,
											outcome: 'unresolved',
											settlement: 'unresolved',
											error: event.error
										})
									})
								}
							}
						},
						checkingPersistence: {
							always: [
								{
									guard: ({ context }) => context.persistence?.outcome === 'succeeded',
									target: 'finishing',
									actions: assign({
										result: ({ context }): CreationResult => ({
											...empty,
											outcome: 'complete',
											settlement: 'locallyPersisted',
											workspace:
												context.persistence?.outcome === 'succeeded'
													? context.persistence.workspace
													: undefined
										})
									})
								},
								{
									guard: ({ context }) => context.persistence?.settlement === 'unresolved',
									target: 'finishing',
									actions: assign({
										result: { ...empty, outcome: 'unresolved', settlement: 'unresolved' }
									})
								},
								{
									guard: ({ context }) =>
										context.persistence?.outcome === 'conflict' ||
										context.persistence?.outcome === 'profileUnavailable',
									target: 'finishing',
									actions: assign({ result: { ...empty, outcome: 'conflict' } })
								},
								{
									target: 'finishing',
									actions: assign({
										result: ({ context }): CreationResult => ({
											...empty,
											outcome: 'failed',
											settlement: context.persistence?.settlement ?? 'notStarted'
										})
									})
								}
							]
						},
						finishing: {
							always: [
								{ guard: 'closing', target: '#workspace-creation-operation.closed' },
								{ guard: 'cancelling', target: '#workspace-creation-operation.cancelled' },
								{
									guard: ({ context }) => context.result.outcome === 'complete',
									target: '#workspace-creation-operation.complete'
								},
								{
									guard: ({ context }) => context.result.outcome === 'editing',
									target: '#workspace-creation-operation.editing'
								},
								{
									guard: ({ context }) => context.result.outcome === 'invalid',
									target: '#workspace-creation-operation.invalid'
								},
								{
									guard: ({ context }) => context.result.outcome === 'recovered',
									target: '#workspace-creation-operation.recovered'
								},
								{
									guard: ({ context }) => context.result.outcome === 'conflict',
									target: '#workspace-creation-operation.conflict'
								},
								{
									guard: ({ context }) => context.result.outcome === 'unresolved',
									target: '#workspace-creation-operation.unresolved'
								},
								{ target: '#workspace-creation-operation.failed' }
							]
						}
					}
				}
			}
		},
		complete: { type: 'final' },
		editing: { type: 'final' },
		invalid: { type: 'final' },
		recovered: { type: 'final' },
		conflict: { type: 'final' },
		unresolved: { type: 'final' },
		failed: { type: 'final' },
		closed: {
			type: 'final',
			entry: assign({ result: ({ context }) => ({ ...context.result, outcome: 'closed' }) })
		},
		cancelled: {
			type: 'final',
			entry: assign({ result: ({ context }) => ({ ...context.result, outcome: 'cancelled' }) })
		}
	}
})
