import { assign, fromPromise, sendParent, setup, stateIn } from 'xstate'
import { app } from '#lib/schema.js'
import { syncAttemptSchema, syncAccountCompletionSchema } from '#lib/validation/bank-sync-log.js'
import { stableUuid } from '#lib/data.js'
import type {
	SyncLogStart,
	SyncLogCompletion,
	SyncLogEvent,
	SyncLogOutput,
	SyncLogParentEvent,
	SyncLogAccountResult
} from '#lib/contracts/bank-sync-log.js'
import type { Dependencies } from './types.js'

type Context = {
	start: SyncLogStart
	result: SyncLogCompletion | undefined
	output: SyncLogOutput | undefined
	accounts: readonly SyncLogAccountResult[]
	accountIndex: number
	accountRowId: string | undefined
}
function accountValues(context: Context) {
	const account = context.accounts[context.accountIndex]
	if (!account) throw new Error('Missing account log result')
	return { ...account, attemptId: context.start.id, organizationId: context.start.organizationId }
}
function initialValues(start: SyncLogStart) {
	return {
		organizationId: start.organizationId,
		connectionId: start.connectionId,
		initiatedBy: start.initiatedBy,
		startedAt: start.startedAt,
		finishedAt: null,
		outcome: 'unfinished',
		importSettlement: 'notStarted',
		failureCode: null,
		importedCount: null,
		existingCount: null,
		omittedCount: null
	}
}
function completion(context: Context) {
	if (!context.result) throw new Error('Missing sync result')
	return context.result
}

function logFailure(
	context: Context,
	reason: Exclude<SyncLogOutput, { kind: 'recorded' }>['reason']
): SyncLogOutput {
	const attemptId = context.start.id
	return reason === 'invalidStart' || reason === 'startWriteFailed'
		? { kind: 'notStarted', attemptId, reason }
		: { kind: 'resultUnrecorded', attemptId, result: completion(context), reason }
}

/** Owns log writes only. The bank operation retains credentials, locks and import cleanup. */
export function createSyncLogMachine({ db }: Pick<Dependencies, 'db'>) {
	const actors = {
		accountId: fromPromise<string, { attemptId: string; accountId: string }>(({ input }) =>
			stableUuid(input.attemptId, `sync-account:${input.accountId}`)
		),
		recordAccount: fromPromise<void, { id: string; values: ReturnType<typeof accountValues> }>(
			async ({ input }) => {
				await db
					.insert(app.simplefinSyncAccountResults, input.values, { id: input.id })
					.wait({ tier: 'local' })
			}
		),
		recordStart: fromPromise<void, SyncLogStart>(async ({ input }) => {
			await db
				.insert(app.simplefinSyncAttempts, syncAttemptSchema.parse(initialValues(input)), {
					id: input.id
				})
				.wait({ tier: 'local' })
		}),
		recordResult: fromPromise<void, { start: SyncLogStart; result: SyncLogCompletion }>(
			async ({ input }) => {
				await db
					.update(app.simplefinSyncAttempts, input.start.id, input.result)
					.wait({ tier: 'local' })
			}
		)
	}
	return setup<
		Context,
		SyncLogEvent,
		typeof actors,
		{},
		{},
		{ startCancelling: undefined },
		never,
		string,
		SyncLogStart,
		SyncLogOutput
	>({
		actors,
		guards: { startCancelling: stateIn({ recordingStart: 'cancelling' }) }
	}).createMachine({
		id: 'bank-sync-log',
		context: ({ input }) => ({
			start: input,
			result: undefined,
			output: undefined,
			accounts: [],
			accountIndex: 0,
			accountRowId: undefined
		}),
		initial: 'validatingStart',
		output: ({ context }) => {
			if (!context.output) throw new Error('Missing sync log output')
			return context.output
		},
		states: {
			validatingStart: {
				always: [
					{
						guard: ({ context }) =>
							syncAttemptSchema.safeParse(initialValues(context.start)).success,
						target: 'recordingStart'
					},
					{ target: 'invalidStart' }
				],
				on: { CANCEL: 'invalidStart' }
			},
			recordingStart: {
				initial: 'working',
				states: { working: { on: { CANCEL: 'cancelling' } }, cancelling: {} },
				invoke: {
					src: 'recordStart',
					input: ({ context }) => context.start,
					onDone: [
						{
							guard: 'startCancelling',
							target: 'validatingResult',
							actions: assign({
								result: () => ({
									outcome: 'cancelled',
									finishedAt: new Date(),
									importSettlement: 'notStarted',
									failureCode: null,
									importedCount: null,
									existingCount: null,
									omittedCount: null
								})
							})
						},
						{ target: 'awaitingResult' }
					],
					onError: 'startWriteFailed'
				}
			},
			awaitingResult: {
				initial: 'working',
				entry: sendParent(({ context }): SyncLogParentEvent => ({
					type: 'SYNC_LOG_READY',
					attemptId: context.start.id
				})),
				states: { working: { on: { CANCEL: 'cancelling' } }, cancelling: {} },
				// Cancellation requests do not invent an import outcome. Wait for the operation's drained result.
				on: {
					FINISH: {
						target: 'validatingResult',
						actions: assign({
							result: ({ event }) => event.result,
							accounts: ({ event }) => event.accounts ?? []
						})
					}
				}
			},
			validatingResult: {
				always: [
					{
						guard: ({ context }) =>
							syncAttemptSchema.safeParse({
								...initialValues(context.start),
								...completion(context)
							}).success &&
							new Set(context.accounts.map((account) => account.accountId)).size ===
								context.accounts.length &&
							context.accounts.every(
								(account) =>
									syncAccountCompletionSchema.safeParse({
										...account,
										attemptId: context.start.id,
										organizationId: context.start.organizationId
									}).success
							),
						target: 'nextAccount'
					},
					{ target: 'invalidResult' }
				]
			},
			nextAccount: {
				always: [
					{
						guard: ({ context }) => context.accountIndex < context.accounts.length,
						target: 'identifyingAccount'
					},
					{ target: 'recordingResult' }
				]
			},
			identifyingAccount: {
				on: { CANCEL: {} },
				invoke: {
					src: 'accountId',
					input: ({ context }) => ({
						attemptId: context.start.id,
						accountId: accountValues(context).accountId
					}),
					onDone: {
						target: 'recordingAccount',
						actions: assign({ accountRowId: ({ event }) => event.output })
					},
					onError: 'accountWriteFailed'
				}
			},
			recordingAccount: {
				on: { CANCEL: {} },
				invoke: {
					src: 'recordAccount',
					input: ({ context }) => {
						if (!context.accountRowId) throw new Error('Missing account log identity')
						return { id: context.accountRowId, values: accountValues(context) }
					},
					onDone: {
						target: 'nextAccount',
						actions: assign({
							accountIndex: ({ context }) => context.accountIndex + 1,
							accountRowId: undefined
						})
					},
					onError: 'accountWriteFailed'
				}
			},
			accountWriteFailed: {
				type: 'final',
				entry: assign({ output: ({ context }) => logFailure(context, 'accountWriteFailed') })
			},
			recordingResult: {
				// Cancellation does not abort the SDK write. The wrapper bounds its wait.
				on: { CANCEL: {} },
				invoke: {
					src: 'recordResult',
					input: ({ context }) => ({ start: context.start, result: completion(context) }),
					onDone: 'recorded',
					onError: 'resultWriteFailed'
				}
			},
			invalidStart: {
				type: 'final',
				entry: assign({ output: ({ context }) => logFailure(context, 'invalidStart') })
			},
			startWriteFailed: {
				type: 'final',
				entry: assign({ output: ({ context }) => logFailure(context, 'startWriteFailed') })
			},
			recorded: {
				type: 'final',
				entry: assign({
					output: ({ context }): SyncLogOutput => ({
						kind: 'recorded',
						attemptId: context.start.id,
						result: completion(context)
					})
				})
			},
			invalidResult: {
				type: 'final',
				entry: assign({ output: ({ context }) => logFailure(context, 'invalidResult') })
			},
			resultWriteFailed: {
				type: 'final',
				entry: assign({ output: ({ context }) => logFailure(context, 'resultWriteFailed') })
			}
		}
	})
}
