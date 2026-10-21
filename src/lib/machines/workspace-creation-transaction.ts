import { assign, fromPromise, setup, stateIn, type OutputFrom } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import { app, type Organization } from '../schema.js'
import type { WorkspaceCreationAttempt } from '../domain/workspace-creation.js'

export type WorkspacePersistenceEvent = { type: 'CANCEL' } | { type: 'SHUTDOWN' }
export type WorkspacePersistenceResult =
	| { outcome: 'succeeded'; settlement: 'locallyPersisted'; workspace: Organization }
	| { outcome: 'profileUnavailable' | 'conflict'; settlement: 'notStarted' }
	| { outcome: 'failed'; settlement: 'notStarted' | 'unresolved'; error: unknown }
	| {
			outcome: 'cancelled' | 'closed'
			settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
	  }

type Db = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
type Transaction = ReturnType<Db['beginTransaction']>
type Input = { db: Db; attempt: WorkspaceCreationAttempt }
type Event = WorkspacePersistenceEvent

// Boundary narrowing only; workflow eligibility is decided by guarded states below.
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing workspace transaction resource')
	return value
}

const open = fromPromise(({ input }: { input: Db }) => Promise.resolve(input.beginTransaction()))
const read = fromPromise(
	async ({ input }: { input: { tx: Transaction; attempt: WorkspaceCreationAttempt } }) => {
		const { tx, attempt } = input
		const [profile, organization, membership, categories] = await Promise.all([
			tx.one(app.profiles.where({ id: attempt.profileId, userId: attempt.workspace.ownerId })),
			tx.one(app.organizations.where({ id: attempt.organizationId })),
			tx.one(app.organizationMembers.where({ id: attempt.membershipId })),
			tx.all(app.categories.where({ organizationId: attempt.organizationId }))
		])
		return { profile, organization, membership, categories }
	}
)
const insert = fromPromise(
	async ({ input }: { input: { tx: Transaction; attempt: WorkspaceCreationAttempt } }) => {
		const { tx, attempt } = input
		const workspace = tx.insert(app.organizations, attempt.workspace, {
			id: attempt.organizationId
		})
		tx.insert(
			app.organizationMembers,
			{
				organizationId: attempt.organizationId,
				userId: attempt.workspace.ownerId,
				profileId: attempt.profileId,
				role: 'owner',
				accountAccessMode: 'all'
			},
			{ id: attempt.membershipId }
		)
		for (const { id, ...category } of attempt.categories) {
			tx.insert(app.categories, { organizationId: attempt.organizationId, ...category }, { id })
		}
		return workspace
	}
)
const commit = fromPromise(({ input }: { input: Transaction }) => Promise.resolve(input.commit()))
const settle = fromPromise(({ input }: { input: OutputFrom<typeof commit> }) =>
	input.wait({ tier: 'local' })
)
const rollback = fromPromise(({ input }: { input: Transaction }) => input.rollback())

type Context = Input & {
	tx: Transaction | undefined
	records: OutputFrom<typeof read> | undefined
	workspace: Organization | undefined
	write: OutputFrom<typeof commit> | undefined
	result: WorkspacePersistenceResult | undefined
}

/** Owns one open Jazz transaction across guarded checks, staging, commit and cleanup. */
export const workspaceCreationTransaction = setup<
	Context,
	Event,
	{
		open: typeof open
		read: typeof read
		insert: typeof insert
		commit: typeof commit
		settle: typeof settle
		rollback: typeof rollback
	},
	{},
	{},
	{ closing: undefined; cancelling: undefined },
	never,
	string,
	Input,
	WorkspacePersistenceResult
>({
	actors: { open, read, insert, commit, settle, rollback },
	guards: {
		closing: stateIn({ running: { control: 'closing' } }),
		cancelling: stateIn({ running: { control: 'cancelling' } })
	}
}).createMachine({
	id: 'workspace-creation-transaction',
	context: ({ input }) => ({
		...input,
		tx: undefined,
		records: undefined,
		workspace: undefined,
		write: undefined,
		result: undefined
	}),
	initial: 'running',
	output: ({ context }) => required(context.result),
	states: {
		running: {
			type: 'parallel',
			states: {
				control: {
					initial: 'active',
					states: {
						active: {
							on: {
								CANCEL: { target: 'cancelling' },
								SHUTDOWN: { target: 'closing' }
							}
						},
						cancelling: {
							on: {
								CANCEL: {},
								SHUTDOWN: { target: 'closing' }
							}
						},
						closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
					}
				},
				work: {
					initial: 'opening',
					states: {
						opening: {
							invoke: {
								src: 'open',
								input: ({ context }) => context.db,
								onDone: {
									target: 'checkingAfterOpen',
									actions: assign({ tx: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
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
						checkingAfterOpen: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{ target: 'reading' }
							]
						},
						reading: {
							invoke: {
								src: 'read',
								input: ({ context }) => ({ tx: required(context.tx), attempt: context.attempt }),
								onDone: {
									target: 'checkingProfile',
									actions: assign({ records: ({ event }) => event.output })
								},
								onError: {
									target: 'rollingBack',
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
						checkingProfile: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{
									guard: ({ context }) => context.records?.profile != null,
									target: 'checkingAttempt'
								},
								{
									target: 'rollingBack',
									actions: assign({
										result: (): WorkspacePersistenceResult => ({
											outcome: 'profileUnavailable',
											settlement: 'notStarted'
										})
									})
								}
							]
						},
						checkingAttempt: {
							always: [
								{
									guard: ({ context }) =>
										context.records?.organization == null &&
										context.records?.membership == null &&
										context.records?.categories.length === 0,
									target: 'staging'
								},
								{
									target: 'rollingBack',
									actions: assign({
										result: (): WorkspacePersistenceResult => ({
											outcome: 'conflict',
											settlement: 'notStarted'
										})
									})
								}
							]
						},
						staging: {
							invoke: {
								src: 'insert',
								input: ({ context }) => ({ tx: required(context.tx), attempt: context.attempt }),
								onDone: {
									target: 'checkingBeforeCommit',
									actions: assign({ workspace: ({ event }) => event.output })
								},
								onError: {
									target: 'rollingBack',
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
						checkingBeforeCommit: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{ target: 'committing' }
							]
						},
						committing: {
							invoke: {
								src: 'commit',
								input: ({ context }) => required(context.tx),
								onDone: {
									target: 'settling',
									actions: assign({ write: ({ event }) => event.output })
								},
								onError: {
									target: 'rollingBack',
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
						settling: {
							invoke: {
								src: 'settle',
								input: ({ context }) => required(context.write),
								onDone: {
									target: 'finishing',
									actions: assign({
										result: ({ context }): WorkspacePersistenceResult => ({
											outcome: 'succeeded',
											settlement: 'locallyPersisted',
											workspace: required(context.workspace)
										})
									})
								},
								onError: {
									target: 'rollingBack',
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
						rollingBack: {
							invoke: {
								src: 'rollback',
								input: ({ context }) => required(context.tx),
								onDone: [
									{ guard: ({ event }) => event.output, target: 'finishing' },
									{
										target: 'finishing',
										actions: assign({
											result: (): WorkspacePersistenceResult => ({
												outcome: 'failed',
												settlement: 'unresolved',
												error: new Error('Workspace transaction rollback was not confirmed')
											})
										})
									}
								],
								onError: {
									target: 'finishing',
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
						finishing: {
							always: [
								{ guard: 'closing', target: '#workspace-creation-transaction.closed' },
								{ guard: 'cancelling', target: '#workspace-creation-transaction.cancelled' },
								{ target: '#workspace-creation-transaction.completed' }
							]
						}
					}
				}
			}
		},
		closed: {
			type: 'final',
			entry: assign({
				result: ({ context }): WorkspacePersistenceResult => ({
					outcome: 'closed',
					settlement: context.result?.settlement ?? 'notStarted'
				})
			})
		},
		cancelled: {
			type: 'final',
			entry: assign({
				result: ({ context }): WorkspacePersistenceResult => ({
					outcome: 'cancelled',
					settlement: context.result?.settlement ?? 'notStarted'
				})
			})
		},
		completed: { type: 'final' }
	}
})
