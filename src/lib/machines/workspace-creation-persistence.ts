import { assign, fromPromise, sendTo, setup } from 'xstate'
import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '../schema.js'
import { workspaceCreationAttemptSchema } from '../validation/identity.js'
import type { WorkspaceCreationAttempt } from '../domain/workspace-creation.js'
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
const hydrate = fromPromise(async ({ input }: { input: Input }) => {
	const { db, attempt } = input
	const options = { tier: ReadTier.LocalFirst }
	await Promise.all([
		db.all(
			app.profiles.where({ id: attempt.profileId, userId: attempt.workspace.ownerId }),
			options
		),
		db.all(app.organizations.where({ id: attempt.organizationId }), options),
		db.all(app.organizationMembers.where({ id: attempt.membershipId }), options),
		db.all(app.categories.where({ organizationId: attempt.organizationId }), options)
	])
})

/** Hydrate before opening a snapshot; the transaction child owns all write decisions/resources. */
export const persistWorkspaceCreation = setup<
	Context,
	WorkspacePersistenceEvent,
	{
		validate: typeof validate
		hydrate: typeof hydrate
		transaction: typeof workspaceCreationTransaction
	},
	{},
	{},
	{},
	never,
	string,
	Input,
	WorkspacePersistenceResult
>({ actors: { validate, hydrate, transaction: workspaceCreationTransaction } }).createMachine({
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
				onDone: { target: 'hydrating', actions: assign({ attempt: ({ event }) => event.output }) },
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
		hydrating: {
			invoke: {
				src: 'hydrate',
				input: ({ context }) => context,
				onDone: 'transacting',
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
