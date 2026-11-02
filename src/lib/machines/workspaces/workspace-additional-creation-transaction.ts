import { assign, sendTo, setup } from 'xstate'
import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import type {
	WorkspaceCreationAttempt as SharedAttempt,
	WorkspaceCreationResult
} from 'delightful-local-first/workspace/creation/contracts'
import { ACCOUNT_ACCESS } from '../../domain/account-access.js'
import { ORGANIZATION_ROLE } from '../../domain/organization-role.js'
import { app, type Organization } from '../../schema.js'
import type { WorkspaceCreationAttempt } from '../../domain/workspace-creation.js'
import { workspaceCreationAttemptSchema } from '../../validation/identity.js'
import type {
	WorkspacePersistenceEvent,
	WorkspacePersistenceResult
} from './workspace-creation-transaction.js'

type Db = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
type Transaction = ReturnType<Db['beginTransaction']>
type Attempt = SharedAttempt<WorkspaceCreationAttempt>

/** One related snapshot from the same mergeable transaction, with no remote preflight. */
async function readLocal(transaction: Transaction, { draft: attempt }: Attempt) {
	const options = { tier: ReadTier.LocalFirst }
	const [profile, organization, membership, categories] = await Promise.all([
		transaction.one(
			app.profiles.where({ id: attempt.profileId, userId: attempt.workspace.ownerId }),
			options
		),
		transaction.one(app.organizations.where({ id: attempt.organizationId }), options),
		transaction.one(app.organizationMembers.where({ id: attempt.membershipId }), options),
		transaction.all(app.categories.where({ organizationId: attempt.organizationId }), options)
	])
	return { profile, organization, membership, categories }
}

/** Unconditional staging only. The shared statechart has already assessed snapshot eligibility. */
function stage(transaction: Transaction, { draft }: Attempt) {
	const attempt = workspaceCreationAttemptSchema.parse(draft)
	const workspace = transaction.insert(app.organizations, attempt.workspace, {
		id: attempt.organizationId
	})
	transaction.insert(
		app.organizationMembers,
		{
			organizationId: attempt.organizationId,
			userId: attempt.workspace.ownerId,
			profileId: attempt.profileId,
			role: ORGANIZATION_ROLE.OWNER,
			accountAccessMode: ACCOUNT_ACCESS.ALL
		},
		{ id: attempt.membershipId }
	)
	for (const { id, ...category } of attempt.categories)
		transaction.insert(
			app.categories,
			{ organizationId: attempt.organizationId, ...category },
			{ id }
		)
	return workspace
}

function domainResult(
	result: WorkspaceCreationResult<WorkspaceCreationAttempt, Organization>
): WorkspacePersistenceResult {
	if (result.outcome === 'succeeded')
		return {
			outcome: 'succeeded',
			settlement: 'locallyPersisted',
			workspace: result.settlement.workspace
		}
	if (result.outcome === 'blocked')
		return {
			outcome: result.reason === 'profileUnavailable' ? 'profileUnavailable' : 'conflict',
			settlement: 'notStarted'
		}
	if (result.outcome === 'failed')
		return { outcome: 'failed', settlement: result.settlement.kind, error: result.error }
	return { outcome: result.outcome, settlement: result.settlement.kind }
}

/** Bind once per creation owner. Finance retains schemas/journals; the library owns resource lifetime. */
export function createAdditionalWorkspaceTransaction(db: Db) {
	const transaction = createWorkspaceCreationTransaction<
		WorkspaceCreationAttempt,
		Transaction,
		Awaited<ReturnType<typeof readLocal>>,
		Organization,
		Awaited<ReturnType<Transaction['commit']>>
	>({
		open: () => db.beginTransaction(),
		readLocal,
		assess: (records) => {
			if (!records.profile) return { outcome: 'blocked', reason: 'profileUnavailable' }
			if (records.organization || records.membership || records.categories.length > 0)
				return { outcome: 'blocked', reason: 'conflict' }
			return { outcome: 'eligible' }
		},
		stage,
		commit: (resource) => resource.commit(),
		persistLocal: async (write) => {
			await write.wait({ tier: 'local' })
		},
		rollback: (resource) => resource.rollback()
	})
	return setup<
		{ attempt: WorkspaceCreationAttempt; result: WorkspacePersistenceResult | undefined },
		WorkspacePersistenceEvent,
		{ transaction: typeof transaction },
		{},
		{},
		{},
		never,
		string,
		{ attempt: WorkspaceCreationAttempt },
		WorkspacePersistenceResult
	>({ actors: { transaction } }).createMachine({
		id: 'finance-additional-workspace-transaction',
		initial: 'transacting',
		context: ({ input }) => ({ attempt: input.attempt, result: undefined }),
		output: ({ context }) => {
			if (!context.result) throw new Error('Missing additional workspace result')
			return context.result
		},
		states: {
			transacting: {
				on: {
					CANCEL: { actions: sendTo('transaction', { type: 'CANCEL' }) },
					SHUTDOWN: { actions: sendTo('transaction', { type: 'SHUTDOWN' }) }
				},
				invoke: {
					id: 'transaction',
					src: 'transaction',
					input: ({ context }) => ({
						attempt: {
							operationId: context.attempt.organizationId,
							workspaceId: context.attempt.organizationId,
							membershipId: context.attempt.membershipId,
							draft: context.attempt
						}
					}),
					onDone: {
						target: 'completed',
						actions: assign({ result: ({ event }) => domainResult(event.output) })
					},
					onError: {
						target: 'completed',
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
			completed: { type: 'final' }
		}
	})
}
