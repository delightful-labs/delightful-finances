import { assign, fromPromise, sendTo, setup } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import { workspaceCreationAttemptSchema } from '../validation/identity.js'
import type { WorkspaceCreationAttempt } from '../domain/workspace-creation.js'
import { workspaceCreationReconciliation } from './workspace-creation-reconciliation.js'
import {
	workspaceCreationTransaction,
	type WorkspacePersistenceEvent,
	type WorkspacePersistenceResult
} from './workspace-creation-transaction.js'

type Input = {
	db: Pick<ReturnType<typeof getDb>, 'all' | 'beginTransaction'>
	attempt: WorkspaceCreationAttempt
}
type Context = Input & { result: WorkspacePersistenceResult | undefined }
const validate = fromPromise<WorkspaceCreationAttempt, WorkspaceCreationAttempt>(({ input }) =>
	Promise.resolve(workspaceCreationAttemptSchema.parse(input))
)
/** Reconcile once before opening a snapshot; the transaction child rechecks atomic eligibility. */
export const persistWorkspaceCreation = setup<
	Context,
	WorkspacePersistenceEvent,
	{
		validate: typeof validate
		reconcile: typeof workspaceCreationReconciliation
		transaction: typeof workspaceCreationTransaction
	},
	{},
	{},
	{},
	never,
	string,
	Input,
	WorkspacePersistenceResult
>({
	actors: {
		validate,
		reconcile: workspaceCreationReconciliation,
		transaction: workspaceCreationTransaction
	}
}).createMachine({
	id: 'workspace-creation-persistence',
	context: ({ input }) => ({ ...input, result: undefined }),
	initial: 'validating',
	output: ({ context }) => {
		if (!context.result) throw new Error('Missing workspace persistence outcome')
		return context.result
	},
	on: { CANCEL: '.cancelled', SHUTDOWN: '.closed' },
	states: {
		validating: {
			invoke: {
				src: 'validate',
				input: ({ context }) => context.attempt,
				onDone: {
					target: 'reconciling',
					actions: assign({ attempt: ({ event }) => event.output })
				},
				onError: {
					target: 'failed',
					actions: assign({
						result: ({ event }): WorkspacePersistenceResult => ({
							outcome: 'failed',
							settlement: 'notStarted',
							error: event.error
						})
					})
				}
			}
		},
		reconciling: {
			invoke: {
				src: 'reconcile',
				input: ({ context }) => context,
				onDone: [
					{ guard: ({ event }) => event.output.outcome === 'absent', target: 'transacting' },
					{
						guard: ({ event }) => event.output.outcome === 'matching',
						target: 'completed',
						actions: assign({
							result: ({ event }): WorkspacePersistenceResult => {
								if (event.output.outcome !== 'matching')
									throw new Error('Expected matched workspace')
								return {
									outcome: 'succeeded',
									settlement: 'locallyPersisted',
									workspace: event.output.workspace
								}
							}
						})
					},
					{
						guard: ({ event }) => event.output.outcome === 'profileUnavailable',
						target: 'completed',
						actions: assign({ result: { outcome: 'profileUnavailable', settlement: 'notStarted' } })
					},
					{
						target: 'completed',
						actions: assign({ result: { outcome: 'conflict', settlement: 'notStarted' } })
					}
				],
				onError: {
					target: 'failed',
					actions: assign({
						result: ({ event }): WorkspacePersistenceResult => ({
							outcome: 'failed',
							settlement: 'notStarted',
							error: event.error
						})
					})
				}
			}
		},
		transacting: {
			// Forward interruption without exiting: the resource owner rolls back or drains its commit.
			on: {
				CANCEL: { actions: sendTo('transaction', { type: 'CANCEL' }) },
				SHUTDOWN: { actions: sendTo('transaction', { type: 'SHUTDOWN' }) }
			},
			invoke: {
				id: 'transaction',
				src: 'transaction',
				input: ({ context }) => context,
				onDone: { target: 'completed', actions: assign({ result: ({ event }) => event.output }) },
				onError: {
					target: 'failed',
					actions: assign({
						result: ({ event }): WorkspacePersistenceResult => ({
							outcome: 'failed',
							settlement: 'unresolved',
							error: event.error
						})
					})
				}
			}
		},
		cancelled: {
			type: 'final',
			entry: assign({
				result: (): WorkspacePersistenceResult => ({
					outcome: 'cancelled',
					settlement: 'notStarted'
				})
			})
		},
		closed: {
			type: 'final',
			entry: assign({
				result: (): WorkspacePersistenceResult => ({ outcome: 'closed', settlement: 'notStarted' })
			})
		},
		completed: { type: 'final' },
		failed: { type: 'final' }
	}
})
