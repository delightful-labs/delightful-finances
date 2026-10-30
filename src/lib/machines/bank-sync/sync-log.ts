import { assign, fromPromise, sendParent, setup, stateIn } from 'xstate'
import { app } from '#lib/schema.js'
import { syncAttemptSchema } from '#lib/validation/bank-sync-log.js'
import type {
	SyncLogStart,
	SyncLogCompletion,
	SyncLogEvent,
	SyncLogOutput,
	SyncLogParentEvent
} from '#lib/contracts/bank-sync-log.js'
import type { Dependencies } from './types.js'

type Context = {
	start: SyncLogStart
	result: SyncLogCompletion | undefined
	output: SyncLogOutput | undefined
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

/** Owns log writes only. The bank operation retains credentials, locks and import cleanup. */
export function createSyncLogMachine({ db }: Pick<Dependencies, 'db'>) {
	const actors = {
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
		context: ({ input }) => ({ start: input, result: undefined, output: undefined }),
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
						actions: assign({ result: ({ event }) => event.result })
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
							}).success,
						target: 'recordingResult'
					},
					{ target: 'invalidResult' }
				]
			},
			recordingResult: {
				// Keep the issued write alive through cancellation; parent must await this actor's completion.
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
				entry: assign({
					output: ({ context }): SyncLogOutput => ({
						kind: 'notStarted',
						attemptId: context.start.id,
						reason: 'invalidStart'
					})
				})
			},
			startWriteFailed: {
				type: 'final',
				entry: assign({
					output: ({ context }): SyncLogOutput => ({
						kind: 'notStarted',
						attemptId: context.start.id,
						reason: 'startWriteFailed'
					})
				})
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
				entry: assign({
					output: ({ context }): SyncLogOutput => ({
						kind: 'resultUnrecorded',
						attemptId: context.start.id,
						result: completion(context),
						reason: 'invalidResult'
					})
				})
			},
			resultWriteFailed: {
				type: 'final',
				entry: assign({
					output: ({ context }): SyncLogOutput => ({
						kind: 'resultUnrecorded',
						attemptId: context.start.id,
						result: completion(context),
						reason: 'resultWriteFailed'
					})
				})
			}
		}
	})
}
