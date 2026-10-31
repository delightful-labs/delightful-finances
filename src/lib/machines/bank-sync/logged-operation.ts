import { assign, raise, sendParent, sendTo, setup, stateIn } from 'xstate'
import { createBankOperationMachine, type OperationResult } from './operation.js'
import { createPreparationMachine } from './preparation.js'
import { createSyncLogMachine } from './sync-log.js'
import { required } from './identity.js'
import {
	emptyCounts,
	bankErrorCode,
	type BankCommand,
	type Dependencies,
	type ProviderSummary,
	type RequestIdentity,
	type ProgressEvent,
	type LockEvent
} from './types.js'
import type {
	SyncLogStart,
	SyncLogCompletion,
	SyncLogOutput,
	SyncLogParentEvent,
	SyncLogEvent,
	SyncLogAccountResult
} from '#lib/contracts/bank-sync-log.js'

type Input = { command: BankCommand; discovered: ProviderSummary[] }
export type LoggedOperationResult = OperationResult & { logging: SyncLogOutput | undefined }
type Context = Input & {
	identity: RequestIdentity
	start: SyncLogStart | undefined
	result: OperationResult | undefined
	logging: SyncLogOutput | undefined
}
function failure(error: unknown): OperationResult {
	return {
		kind: 'failed',
		error,
		counts: emptyCounts(),
		discovered: undefined,
		settlement: 'settled',
		accountResults: []
	}
}
function cancelled(): OperationResult {
	return {
		kind: 'cancelled',
		error: undefined,
		counts: emptyCounts(),
		discovered: undefined,
		settlement: 'settled',
		accountResults: []
	}
}
const failureCodes: Readonly<Record<string, NonNullable<SyncLogCompletion['failureCode']>>> = {
	unlock_failure: 'passkey',
	passkey_failure: 'passkey',
	provider_failure: 'provider',
	mapping: 'mapping',
	other_tab: 'interrupted'
}
function finishedLog(context: Context): Extract<SyncLogEvent, { type: 'FINISH' }> {
	const result = required(context.result)
	const reports = result.accountResults
	const accounts: SyncLogAccountResult[] = []
	for (const report of reports) {
		if (report.account)
			accounts.push({
				accountId: report.account.id,
				accountName: report.account.name,
				outcome:
					report.kind === 'complete'
						? report.counts.omitted > 0
							? 'partial'
							: 'succeeded'
						: report.kind,
				importedCount: report.counts.imported,
				existingCount: report.counts.existing,
				omittedCount: report.counts.omitted,
				failureCode: report.kind === 'failed' ? 'import' : null
			})
	}
	const countsKnown = reports.length > 0 || result.kind === 'complete' || result.kind === 'partial'
	return {
		type: 'FINISH',
		accounts,
		result: {
			outcome: result.kind === 'complete' ? 'succeeded' : result.kind,
			finishedAt: new Date(),
			importSettlement:
				result.settlement === 'unresolved'
					? 'unresolved'
					: result.counts.imported > 0
						? 'locallyPersisted'
						: 'notStarted',
			failureCode:
				result.kind === 'failed'
					? (failureCodes[bankErrorCode(result.error)] ?? 'unexpected')
					: null,
			importedCount: countsKnown ? result.counts.imported : null,
			existingCount: countsKnown ? result.counts.existing : null,
			omittedCount: countsKnown ? result.counts.omitted : null
		}
	}
}

/** Supervises logging; the existing operation retains ownership of locks and credentials. */
export function createLoggedBankOperationMachine(dependencies: Dependencies) {
	const actors = {
		prepare: createPreparationMachine(dependencies),
		log: createSyncLogMachine(dependencies),
		operation: createBankOperationMachine(dependencies)
	}
	return setup<
		Context,
		| { type: 'CANCEL' }
		| { type: 'LOG_FAILED'; error: unknown }
		| ProgressEvent
		| SyncLogParentEvent
		| LockEvent,
		typeof actors,
		{},
		{},
		{ logFailed: undefined },
		never,
		string,
		Input,
		LoggedOperationResult
	>({
		actors,
		guards: { logFailed: stateIn({ logged: { operating: 'logFailed' } }) }
	}).createMachine({
		id: 'logged-bank-operation',
		context: ({ input }) => {
			const observed = dependencies.observe()
			return {
				...input,
				identity: { userId: observed.userId, organizationId: observed.organizationId },
				start: undefined,
				result: undefined,
				logging: undefined
			}
		},
		initial: 'choosing',
		output: ({ context }) => ({ ...required(context.result), logging: context.logging }),
		on: { IMPORT_PROGRESS: { actions: sendParent(({ event }) => event) } },
		states: {
			choosing: {
				always: [
					{ guard: ({ context }) => context.command.type === 'SYNC', target: 'preparing' },
					{ target: 'unlogged' }
				]
			},
			unlogged: {
				initial: 'working',
				states: { working: {}, cancelling: {} },
				on: {
					CANCEL: { target: '.cancelling', actions: sendTo('operation', { type: 'CANCEL' }) },
					LOCK_FAILED: { actions: sendTo('operation', ({ event }) => event) }
				},
				invoke: {
					id: 'operation',
					src: 'operation',
					input: ({ context }) => ({ command: context.command, discovered: context.discovered }),
					onSnapshot: {},
					onDone: { target: 'done', actions: assign({ result: ({ event }) => event.output }) },
					onError: {
						target: 'done',
						actions: assign({ result: ({ event }) => failure(event.error) })
					}
				}
			},
			preparing: {
				on: {
					CANCEL: {
						target: 'done',
						actions: assign({
							result: () => cancelled()
						})
					}
				},
				invoke: {
					src: 'prepare',
					input: ({ context }) => ({ identity: context.identity, requireConnection: true }),
					onDone: [
						{
							guard: ({ event }) => !event.output.ok,
							target: 'done',
							actions: assign({
								result: ({ event }) => failure(event.output.ok ? undefined : event.output.error)
							})
						},
						{
							target: 'logged',
							actions: assign({
								start: ({ event }) => {
									const prepared = required(event.output.ok ? event.output.value : undefined)
									return {
										id: crypto.randomUUID(),
										organizationId: prepared.scope.organizationId,
										connectionId: prepared.scope.connectionId,
										initiatedBy: prepared.scope.ownerId,
										startedAt: new Date()
									}
								}
							})
						}
					],
					onError: {
						target: 'done',
						actions: assign({ result: ({ event }) => failure(event.error) })
					}
				}
			},
			logged: {
				initial: 'starting',
				invoke: {
					id: 'log',
					src: 'log',
					input: ({ context }) => required(context.start),
					onError: { actions: raise(({ event }) => ({ type: 'LOG_FAILED', error: event.error })) },
					onDone: {
						target: 'done',
						actions: assign({
							logging: ({ event }) => event.output,
							result: ({ context, event }) =>
								context.result ??
								(event.output.kind !== 'notStarted'
									? cancelled()
									: failure(new Error('sync_log_start_failed')))
						})
					}
				},
				states: {
					starting: {
						on: {
							LOG_FAILED: {
								target: '#logged-bank-operation.done',
								actions: assign({
									result: ({ event }) => failure(event.error),
									logging: ({ context }) => ({
										kind: 'notStarted',
										attemptId: required(context.start).id,
										reason: 'startWriteFailed'
									})
								})
							},
							SYNC_LOG_READY: {
								guard: ({ context, event }) => event.attemptId === context.start?.id,
								target: 'operating'
							},
							CANCEL: { target: 'cancellingStart', actions: sendTo('log', { type: 'CANCEL' }) }
						}
					},
					cancellingStart: {
						on: {
							LOG_FAILED: {
								target: '#logged-bank-operation.done',
								actions: assign({
									result: () => cancelled(),
									logging: ({ context }) => ({
										kind: 'notStarted',
										attemptId: required(context.start).id,
										reason: 'startWriteFailed'
									})
								})
							},
							CANCEL: {},
							SYNC_LOG_READY: {
								guard: ({ context, event }) => event.attemptId === context.start?.id,
								actions: [
									assign({
										result: () => cancelled()
									}),
									sendTo('log', ({ context }) => finishedLog(context))
								]
							}
						}
					},
					operating: {
						initial: 'working',
						states: {
							working: {},
							cancelling: {},
							logFailed: { on: { CANCEL: { actions: sendTo('operation', { type: 'CANCEL' }) } } }
						},
						on: {
							LOG_FAILED: { target: '.logFailed' },
							LOCK_FAILED: { actions: sendTo('operation', ({ event }) => event) },
							CANCEL: {
								target: '.cancelling',
								actions: [
									sendTo('operation', { type: 'CANCEL' }),
									sendTo('log', { type: 'CANCEL' })
								]
							}
						},
						invoke: {
							id: 'operation',
							src: 'operation',
							input: ({ context }) => ({
								command: context.command,
								discovered: context.discovered,
								identity: context.identity
							}),
							onSnapshot: {},
							onDone: [
								{
									guard: 'logFailed',
									target: 'resultLogFailed',
									actions: assign({ result: ({ event }) => event.output })
								},
								{ target: 'finishing', actions: assign({ result: ({ event }) => event.output }) }
							],
							onError: [
								{
									guard: 'logFailed',
									target: 'resultLogFailed',
									actions: assign({
										result: ({ event }) => ({ ...failure(event.error), settlement: 'unresolved' })
									})
								},
								{
									target: 'finishing',
									actions: assign({
										result: ({ event }) => ({ ...failure(event.error), settlement: 'unresolved' })
									})
								}
							]
						}
					},
					resultLogFailed: {
						entry: assign({
							logging: ({ context }) => ({
								kind: 'resultUnrecorded',
								attemptId: required(context.start).id,
								result: finishedLog(context).result,
								reason: 'resultWriteFailed'
							})
						}),
						always: '#logged-bank-operation.done'
					},
					finishing: {
						entry: sendTo('log', ({ context }) => finishedLog(context)),
						on: { CANCEL: {}, LOG_FAILED: 'resultLogFailed' }
					}
				}
			},
			done: { type: 'final' }
		}
	})
}
