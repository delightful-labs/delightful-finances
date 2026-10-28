import { assign, fromPromise, sendTo, setup, type OutputFrom } from 'xstate'
import { ReadTier } from 'jazz-tools'
import { workspaceFakeData } from './workspace-fake-data.js'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '../schema.js'
import { m } from '../paraglide/messages.js'
import { stableUuid } from '../domain/stable-uuid.js'
import {
	prepareWorkspaceCreation,
	type WorkspaceCreationAttempt
} from '../domain/workspace-creation.js'
import {
	workspaceCreationTransaction,
	type WorkspacePersistenceEvent,
	type WorkspacePersistenceResult
} from './workspace-creation-transaction.js'

type Db = Pick<
	ReturnType<typeof getDb>,
	'all' | 'beginTransaction' | 'beginExclusiveTransaction' | 'getConfig'
>
type Input = { db: Db; userId: string }
export type WorkspaceInitializationResult =
	| { outcome: 'ready'; profileId: string }
	| {
			outcome: 'unavailable'
			reason:
				'authorityUnavailable' | 'initializationMissing' | 'profileMissing' | 'duplicateProfiles'
	  }
	| WorkspacePersistenceResult

type ReadInput = Input & { tier: typeof ReadTier.LocalFirstUnlessEmpty | typeof ReadTier.Remote }
const discover = fromPromise(async ({ input }: { input: ReadInput }) => {
	const [profiles, organizations] = await Promise.all([
		input.db.all(app.profiles.where({ userId: input.userId }), { tier: input.tier }),
		// Membership policies, not creator/kind, decide which workspaces are accessible.
		input.db.all(app.organizations.orderBy('id'), { tier: input.tier })
	])
	return { profiles, organizations, serverConfigured: Boolean(input.db.getConfig().serverUrl) }
})
const prepareInitial = fromPromise(async ({ input }: { input: Input }) => {
	const [organizationId, profileId, membershipId] = await Promise.all([
		stableUuid(input.userId, 'personal-organization'),
		stableUuid(input.userId, 'profile'),
		stableUuid(input.userId, 'personal-membership')
	])
	const attempt = await prepareWorkspaceCreation({
		organizationId,
		profileId,
		userId: input.userId,
		name: m['defaults.workspace']()
	})
	// Keep bootstrap membership IDs stable across retries without making this workspace special.
	return { ...attempt, membershipId }
})

type Context = Input & {
	records: OutputFrom<typeof discover> | undefined
	attempt: WorkspaceCreationAttempt | undefined
	result: WorkspaceInitializationResult | undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing workspace initialization observation')
	return value
}

/** Initialization provenance is independent of the active workspace/route. No writes on empty cache alone. */
export const workspaceInitialization = setup<
	Context,
	WorkspacePersistenceEvent,
	{
		discover: typeof discover
		prepareInitial: typeof prepareInitial
		transaction: typeof workspaceCreationTransaction
		fakeData: typeof workspaceFakeData
	},
	{},
	{},
	{},
	never,
	string,
	Input,
	WorkspaceInitializationResult
>({
	actors: {
		discover,
		prepareInitial,
		transaction: workspaceCreationTransaction,
		fakeData: workspaceFakeData
	}
}).createMachine({
	id: 'workspace-initialization',
	context: ({ input }) => ({
		...input,
		records: undefined,
		attempt: undefined,
		result: undefined
	}),
	initial: 'readingLocal',
	output: ({ context }) => required(context.result),
	on: {
		CANCEL: { target: '.cancelled' },
		SHUTDOWN: { target: '.closed' }
	},
	states: {
		readingLocal: {
			invoke: {
				src: 'discover',
				input: ({ context }) => ({
					db: context.db,
					userId: context.userId,
					tier: ReadTier.LocalFirstUnlessEmpty
				}),
				onDone: {
					target: 'checkingProfiles',
					actions: assign({ records: ({ event }) => event.output })
				},
				onError: {
					target: 'failed',
					actions: assign({
						result: ({ event }): WorkspaceInitializationResult => ({
							outcome: 'failed',
							settlement: 'notStarted',
							error: event.error
						})
					})
				}
			}
		},
		checkingProfiles: {
			always: [
				{
					guard: ({ context }) => (context.records?.profiles.length ?? 0) > 1,
					target: 'duplicateProfiles'
				},
				{ target: 'checkingInitialization' }
			]
		},
		checkingInitialization: {
			always: [
				{
					guard: ({ context }) => context.records?.profiles[0]?.initialWorkspaceId != null,
					target: 'preparingFakeData'
				},
				{ target: 'checkingAuthority' }
			]
		},
		checkingAuthority: {
			always: [
				{
					guard: ({ context }) => context.records?.serverConfigured === true,
					target: 'awaitingAuthority'
				},
				{ target: 'authorityUnavailable' }
			]
		},
		awaitingAuthority: {
			// Remote waits offline; no timeout or empty local result authorizes bootstrap.
			invoke: {
				src: 'discover',
				input: ({ context }) => ({ db: context.db, userId: context.userId, tier: ReadTier.Remote }),
				onDone: {
					target: 'checkingAuthoritativeProfiles',
					actions: assign({ records: ({ event }) => event.output })
				},
				onError: {
					target: 'failed',
					actions: assign({
						result: ({ event }): WorkspaceInitializationResult => ({
							outcome: 'failed',
							settlement: 'notStarted',
							error: event.error
						})
					})
				}
			}
		},
		checkingAuthoritativeProfiles: {
			always: [
				{
					guard: ({ context }) => (context.records?.profiles.length ?? 0) > 1,
					target: 'duplicateProfiles'
				},
				{
					guard: ({ context }) => context.records?.profiles[0]?.initialWorkspaceId != null,
					target: 'preparingFakeData'
				},
				{
					guard: ({ context }) => context.records?.profiles.length === 1,
					target: 'initializationMissing'
				},
				{
					guard: ({ context }) => (context.records?.organizations.length ?? 0) > 0,
					target: 'profileMissing'
				},
				{ target: 'preparingInitial' }
			]
		},
		preparingInitial: {
			invoke: {
				src: 'prepareInitial',
				input: ({ context }) => context,
				onDone: {
					target: 'bootstrapping',
					actions: assign({ attempt: ({ event }) => event.output })
				},
				onError: {
					target: 'failed',
					actions: assign({
						result: ({ event }): WorkspaceInitializationResult => ({
							outcome: 'failed',
							settlement: 'notStarted',
							error: event.error
						})
					})
				}
			}
		},
		bootstrapping: {
			on: {
				CANCEL: { actions: sendTo('bootstrap', { type: 'CANCEL' }) },
				SHUTDOWN: { actions: sendTo('bootstrap', { type: 'SHUTDOWN' }) }
			},
			invoke: {
				id: 'bootstrap',
				src: 'transaction',
				input: ({ context }) => ({
					db: context.db,
					attempt: required(context.attempt),
					purpose: 'bootstrap'
				}),
				onDone: [
					{
						guard: ({ event }) => event.output.outcome === 'succeeded',
						target: 'preparingFakeData'
					},
					{ target: 'completed', actions: assign({ result: ({ event }) => event.output }) }
				],
				onError: {
					target: 'failed',
					actions: assign({
						result: ({ event }): WorkspaceInitializationResult => ({
							outcome: 'failed',
							settlement: 'unresolved',
							error: event.error
						})
					})
				}
			}
		},
		preparingFakeData: {
			on: {
				CANCEL: { actions: sendTo('fakeData', { type: 'CANCEL' }) },
				SHUTDOWN: { actions: sendTo('fakeData', { type: 'SHUTDOWN' }) }
			},
			invoke: {
				id: 'fakeData',
				src: 'fakeData',
				input: ({ context }) => ({
					db: context.db,
					userId: context.userId,
					profileId: context.attempt?.profileId ?? required(context.records?.profiles[0]).id,
					organizationId:
						context.attempt?.organizationId ??
						required(required(context.records?.profiles[0]).initialWorkspaceId ?? undefined)
				}),
				onDone: [
					{ guard: ({ event }) => event.output.outcome === 'ready', target: 'ready' },
					{ target: 'completed', actions: assign({ result: ({ event }) => event.output }) }
				],
				onError: {
					target: 'failed',
					actions: assign({
						result: ({ event }): WorkspaceInitializationResult => ({
							outcome: 'failed',
							settlement: 'unresolved',
							error: event.error
						})
					})
				}
			}
		},
		ready: {
			type: 'final',
			entry: assign({
				result: ({ context }): WorkspaceInitializationResult => ({
					outcome: 'ready',
					profileId: context.attempt?.profileId ?? required(context.records?.profiles[0]).id
				})
			})
		},
		duplicateProfiles: {
			type: 'final',
			entry: assign({
				result: (): WorkspaceInitializationResult => ({
					outcome: 'unavailable',
					reason: 'duplicateProfiles'
				})
			})
		},
		profileMissing: {
			type: 'final',
			entry: assign({
				result: (): WorkspaceInitializationResult => ({
					outcome: 'unavailable',
					reason: 'profileMissing'
				})
			})
		},
		authorityUnavailable: {
			type: 'final',
			entry: assign({
				result: (): WorkspaceInitializationResult => ({
					outcome: 'unavailable',
					reason: 'authorityUnavailable'
				})
			})
		},
		initializationMissing: {
			type: 'final',
			entry: assign({
				result: (): WorkspaceInitializationResult => ({
					outcome: 'unavailable',
					reason: 'initializationMissing'
				})
			})
		},
		cancelled: {
			type: 'final',
			entry: assign({
				result: (): WorkspaceInitializationResult => ({
					outcome: 'cancelled',
					settlement: 'notStarted'
				})
			})
		},
		closed: {
			type: 'final',
			entry: assign({
				result: (): WorkspaceInitializationResult => ({
					outcome: 'closed',
					settlement: 'notStarted'
				})
			})
		},
		failed: { type: 'final' },
		completed: { type: 'final' }
	}
})
