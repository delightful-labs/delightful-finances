import { assign, fromPromise, setup, stateIn, type OutputFrom } from 'xstate'
import { ReadTier } from 'jazz-tools'
import { app, type SyncAttempt, type SyncAccountResult } from '#lib/schema.js'
import { canManageBankCredentials } from '#lib/domain/organization-permissions.js'
import { createJazzTransactionActors } from '../persistence/jazz-transaction-actors.js'
import { required } from './identity.js'
import type { Dependencies } from './types.js'

export type RetentionScope = { organizationId: string; connectionId: string; userId: string }
export type RetentionResult = {
	kind: 'cleaned' | 'unchanged' | 'deferred' | 'failed' | 'cancelled'
	deletedCount: number
	settlement: 'notStarted' | 'confirmed' | 'unresolved'
}
type Db = Pick<Dependencies['db'], 'beginExclusiveTransaction'>
type Transaction = ReturnType<Db['beginExclusiveTransaction']>
type Input = { scope: RetentionScope }
type Reader = Pick<Dependencies['db'], 'all'>
type ReadInput = { reader: Reader; scope: RetentionScope; tier: ReadTier }
function sameIds(left: readonly { id: string }[], right: readonly { id: string }[]) {
	const ids = new Set(left.map((row) => row.id))
	return left.length === right.length && right.every((row) => ids.has(row.id))
}
const transactions = createJazzTransactionActors(
	(db: Db) => db.beginExclusiveTransaction(),
	(write: ReturnType<Transaction['commit']>) => write.wait()
)
type Context = Input & {
	error: unknown
	authorityAttempts: readonly SyncAttempt[]
	authorityAccounts: readonly SyncAccountResult[]
	observedAttempts: readonly SyncAttempt[]
	tx: Transaction | undefined
	write: OutputFrom<typeof transactions.commit> | undefined
	attempts: readonly SyncAttempt[]
	accounts: readonly SyncAccountResult[]
	result: RetentionResult
}

/** Owns the exclusive snapshot and atomic deletion; never performs provider work. */
export function createSyncLogRetentionMachine(
	dependencies: Pick<Dependencies, 'db' | 'observe'>,
	deadlineMs = 5000
) {
	const currentIdentity = (scope: RetentionScope) => {
		const observed = dependencies.observe()
		return (
			observed.allowed &&
			observed.userId === scope.userId &&
			observed.organizationId === scope.organizationId
		)
	}
	const actors = {
		...transactions,
		authorization: fromPromise(async ({ input }: { input: ReadInput }) => {
			const [members, connections] = await Promise.all([
				input.reader.all(
					app.organizationMembers.where({
						organizationId: input.scope.organizationId,
						userId: input.scope.userId
					}),
					{ tier: input.tier }
				),
				input.reader.all(
					app.simplefinConnections.where({
						id: input.scope.connectionId,
						organizationId: input.scope.organizationId,
						ownerId: input.scope.userId
					}),
					{ tier: input.tier }
				)
			])
			return (
				connections.length === 1 &&
				members.some((member) => canManageBankCredentials(member, input.scope.organizationId))
			)
		}),
		history: fromPromise(({ input }: { input: ReadInput }) =>
			input.reader.all(
				app.simplefinSyncAttempts
					.where({
						organizationId: input.scope.organizationId,
						connectionId: input.scope.connectionId,
						outcome: { ne: 'unfinished' },
						finishedAt: { isNull: false }
					})
					.orderBy('finishedAt', 'desc')
					.orderBy('id', 'desc'),
				{ tier: input.tier }
			)
		),
		accounts: fromPromise(({ input }: { input: ReadInput & { ids: string[] } }) =>
			input.reader.all(
				app.simplefinSyncAccountResults.where({
					organizationId: input.scope.organizationId,
					attemptId: { in: input.ids }
				}),
				{ tier: input.tier }
			)
		),
		stage: fromPromise(
			({
				input
			}: {
				input: {
					tx: Transaction
					attempts: readonly SyncAttempt[]
					accounts: readonly SyncAccountResult[]
				}
			}) => {
				for (const row of input.accounts) input.tx.delete(app.simplefinSyncAccountResults, row.id)
				for (const row of input.attempts) input.tx.delete(app.simplefinSyncAttempts, row.id)
				return Promise.resolve()
			}
		)
	}
	return setup<
		Context,
		{ type: 'CANCEL' },
		typeof actors,
		{},
		{},
		{ interrupted: undefined; identityCurrent: undefined },
		never,
		string,
		Input,
		RetentionResult
	>({
		actors,
		guards: {
			interrupted: stateIn({ running: { control: 'cancelling' } }),
			identityCurrent: ({ context }) => currentIdentity(context.scope)
		},
		delays: { deadline: deadlineMs }
	}).createMachine({
		id: 'sync-log-retention',
		context: ({ input }) => ({
			...input,
			error: undefined,
			authorityAttempts: [],
			authorityAccounts: [],
			observedAttempts: [],
			tx: undefined,
			write: undefined,
			attempts: [],
			accounts: [],
			result: { kind: 'deferred', deletedCount: 0, settlement: 'notStarted' }
		}),
		initial: 'running',
		output: ({ context }) => context.result,
		states: {
			running: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						states: { active: { on: { CANCEL: 'cancelling' } }, cancelling: { on: { CANCEL: {} } } }
					},
					work: {
						initial: 'checkingIdentity',
						states: {
							checkingIdentity: {
								always: [
									{ guard: 'identityCurrent', target: 'authorizingAuthority' },
									{ target: 'finishing' }
								]
							},
							authorizingAuthority: {
								after: { deadline: 'finishing' },
								on: { CANCEL: 'finishing' },
								invoke: {
									src: 'authorization',
									input: ({ context }) => ({
										reader: dependencies.db,
										scope: context.scope,
										tier: ReadTier.Remote
									}),
									onDone: [
										{ guard: ({ event }) => event.output, target: 'readingAuthorityHistory' },
										{ target: 'finishing' }
									],
									onError: {
										target: 'finishing',
										actions: assign({ error: ({ event }) => event.error })
									}
								}
							},
							readingAuthorityHistory: {
								after: { deadline: 'finishing' },
								on: { CANCEL: 'finishing' },
								invoke: {
									src: 'history',
									input: ({ context }) => ({
										reader: dependencies.db,
										scope: context.scope,
										tier: ReadTier.Remote
									}),
									onDone: {
										target: 'selectingAuthority',
										actions: assign({ authorityAttempts: ({ event }) => event.output })
									},
									onError: {
										target: 'finishing',
										actions: assign({ error: ({ event }) => event.error })
									}
								}
							},
							selectingAuthority: {
								always: [
									{ guard: 'interrupted', target: 'finishing' },
									{
										guard: ({ context }) => context.authorityAttempts.length <= 100,
										target: 'finishing',
										actions: assign({
											result: { kind: 'unchanged', deletedCount: 0, settlement: 'notStarted' }
										})
									},
									{ guard: 'identityCurrent', target: 'readingAuthorityAccounts' },
									{ target: 'finishing' }
								]
							},
							readingAuthorityAccounts: {
								after: { deadline: 'finishing' },
								on: { CANCEL: 'finishing' },
								invoke: {
									src: 'accounts',
									input: ({ context }) => ({
										reader: dependencies.db,
										scope: context.scope,
										tier: ReadTier.Remote,
										ids: context.authorityAttempts.slice(100).map((row) => row.id)
									}),
									onDone: {
										target: 'opening',
										actions: assign({ authorityAccounts: ({ event }) => event.output })
									},
									onError: {
										target: 'finishing',
										actions: assign({ error: ({ event }) => event.error })
									}
								}
							},
							opening: {
								invoke: {
									src: 'open',
									input: () => dependencies.db,
									onDone: {
										target: 'checkingOpened',
										actions: assign({ tx: ({ event }) => event.output })
									},
									onError: {
										target: 'finishing',
										actions: assign({ error: ({ event }) => event.error })
									}
								}
							},
							checkingOpened: {
								always: [{ guard: 'interrupted', target: 'rollingBack' }, { target: 'authorizing' }]
							},
							authorizing: {
								after: { deadline: 'rollingBack' },
								on: { CANCEL: 'rollingBack' },
								invoke: {
									src: 'authorization',
									input: ({ context }) => ({
										reader: required(context.tx),
										scope: context.scope,
										tier: ReadTier.LocalFirst
									}),
									onDone: [
										{ guard: ({ event }) => event.output, target: 'readingHistory' },
										{ target: 'rollingBack' }
									],
									onError: {
										target: 'rollingBack',
										actions: assign({ error: ({ event }) => event.error })
									}
								}
							},
							readingHistory: {
								after: { deadline: 'rollingBack' },
								on: { CANCEL: 'rollingBack' },
								invoke: {
									src: 'history',
									input: ({ context }) => ({
										reader: required(context.tx),
										scope: context.scope,
										tier: ReadTier.LocalFirst
									}),
									onDone: {
										target: 'selecting',
										actions: assign({ observedAttempts: ({ event }) => event.output })
									},
									onError: {
										target: 'rollingBack',
										actions: assign({ error: ({ event }) => event.error })
									}
								}
							},
							selecting: {
								always: [
									{ guard: 'interrupted', target: 'rollingBack' },
									{
										guard: ({ context }) =>
											!sameIds(context.authorityAttempts, context.observedAttempts),
										target: 'rollingBack'
									},
									{
										target: 'readingAccounts',
										actions: assign({
											attempts: ({ context }) => context.observedAttempts.slice(100)
										})
									}
								]
							},
							readingAccounts: {
								after: { deadline: 'rollingBack' },
								on: { CANCEL: 'rollingBack' },
								invoke: {
									src: 'accounts',
									input: ({ context }) => ({
										reader: required(context.tx),
										scope: context.scope,
										tier: ReadTier.LocalFirst,
										ids: context.attempts.map((row) => row.id)
									}),
									onDone: {
										target: 'checkingBeforeStage',
										actions: assign({ accounts: ({ event }) => event.output })
									},
									onError: {
										target: 'rollingBack',
										actions: assign({ error: ({ event }) => event.error })
									}
								}
							},
							checkingBeforeStage: {
								always: [
									{
										guard: ({ context }) => !sameIds(context.authorityAccounts, context.accounts),
										target: 'rollingBack'
									},
									{ guard: 'interrupted', target: 'rollingBack' },
									{ guard: 'identityCurrent', target: 'staging' },
									{ target: 'rollingBack' }
								]
							},
							staging: {
								invoke: {
									src: 'stage',
									input: ({ context }) => ({
										tx: required(context.tx),
										attempts: context.attempts,
										accounts: context.accounts
									}),
									onDone: 'checkingBeforeCommit',
									onError: {
										target: 'rollingBack',
										actions: assign({ error: ({ event }) => event.error })
									}
								}
							},
							checkingBeforeCommit: {
								always: [
									{ guard: 'interrupted', target: 'rollingBack' },
									{ guard: 'identityCurrent', target: 'committing' },
									{ target: 'rollingBack' }
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
											result: { kind: 'failed', deletedCount: 0, settlement: 'unresolved' }
										})
									}
								}
							},
							settling: {
								after: {
									deadline: {
										target: 'finishing',
										actions: assign({
											result: { kind: 'deferred', deletedCount: 0, settlement: 'unresolved' }
										})
									}
								},
								invoke: {
									src: 'settle',
									input: ({ context }) => required(context.write),
									onDone: {
										target: 'finishing',
										actions: assign({
											result: ({ context }) => ({
												kind: 'cleaned',
												deletedCount: context.attempts.length,
												settlement: 'confirmed'
											})
										})
									},
									onError: {
										target: 'finishing',
										actions: assign({
											result: { kind: 'failed', deletedCount: 0, settlement: 'unresolved' }
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
												result: { kind: 'failed', deletedCount: 0, settlement: 'unresolved' }
											})
										}
									],
									onError: {
										target: 'finishing',
										actions: assign({
											result: { kind: 'failed', deletedCount: 0, settlement: 'unresolved' }
										})
									}
								}
							},
							finishing: {
								entry: assign({
									tx: undefined,
									write: undefined,
									attempts: [],
									accounts: [],
									authorityAttempts: [],
									authorityAccounts: [],
									observedAttempts: []
								}),
								always: [
									{ guard: 'interrupted', target: '#sync-log-retention.cancelled' },
									{ target: '#sync-log-retention.done' }
								]
							}
						}
					}
				}
			},
			cancelled: {
				type: 'final',
				entry: assign({ result: ({ context }) => ({ ...context.result, kind: 'cancelled' }) })
			},
			done: { type: 'final' }
		}
	})
}
