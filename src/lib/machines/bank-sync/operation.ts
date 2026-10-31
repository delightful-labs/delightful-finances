import type { EventObject } from 'xstate'
import { assign, fromPromise, sendParent, enqueueActions, setup, stateIn } from 'xstate'
import type { ErrorActorEvent } from 'xstate'
import { app } from '#lib/schema.js'
import { createBankTrace } from '#lib/integrations/diagnostics.js'
import { unlockCredential } from '#lib/integrations/passkey.js'
import {
	fetchAccounts,
	providerAccountIdentity,
	providerBalanceSnapshot
} from '#lib/integrations/simplefin.js'
import { createAuthorizationMachine } from './authorization.js'
import { createAccountMappingMachine } from './accounts.js'
import { createImportMachine } from './import.js'
import { createPreparationMachine } from './preparation.js'
import { required } from './identity.js'
import { bankLock } from './lock.js'
import {
	credentialAuthorization,
	emptyCounts,
	type BankCommand,
	type Dependencies,
	type ImportCounts,
	type ImportResult,
	type AccountImportReport,
	type ImportSettlement,
	type LockEvent,
	type OperationWork,
	type ProgressEvent,
	type ProviderResponse,
	type RequestIdentity,
	type ProviderSummary,
	type BankViewMeta
} from './types.js'

type Input = { command: BankCommand; discovered: ProviderSummary[]; identity?: RequestIdentity }
type Context = Input & {
	identity: RequestIdentity
	work: OperationWork | undefined
	accessUrl: string | undefined
	response: ProviderResponse | undefined
	counts: ImportCounts
	accountResults: readonly AccountImportReport[]
	result: ProviderSummary[] | undefined
	completion: OperationOutcome | undefined
	error: unknown
	importSettlement: ImportSettlement
	writeSettlement: ImportSettlement
	outcome: SyncOutcome | undefined
}
type OperationSummary = {
	counts: ImportCounts
	discovered: ProviderSummary[] | undefined
	settlement: ImportSettlement
}
type OperationOutcome =
	| (OperationSummary & { kind: 'complete' | 'partial' })
	| (OperationSummary & { kind: 'failed' | 'cancelled'; error: unknown })
export type OperationResult = OperationOutcome & { accountResults: readonly AccountImportReport[] }
type SyncOutcome =
	| { lastOutcome: 'succeeded' | 'partial'; lastError: null }
	| { lastOutcome: 'failed'; lastError: 'operation-failed' }

function importCompletion(result: ImportResult) {
	return {
		counts: result.counts,
		accountResults: result.accountResults,
		importSettlement: result.settlement
	}
}

function workFor(context: Context) {
	if (!context.work) throw new Error('missing-command')
	return context.work
}

// Import-data uncertainty survives an independently settled outcome-history write.
function operationSettlement(context: Context): ImportSettlement {
	return context.importSettlement === 'unresolved' ? 'unresolved' : context.writeSettlement
}

export function createBankOperationMachine(dependencies: Dependencies) {
	const { db, observe } = dependencies
	const disconnect = fromPromise<void, OperationWork>(async ({ input, signal }) => {
		signal.throwIfAborted()
		await db
			.update(app.simplefinConnections, input.current.id, {
				status: 'revoked',
				ciphertext: null,
				credentialId: null,
				prfSalt: null,
				iv: null,
				credentialVersion: null,
				accessUrl: ''
			})
			.wait({ tier: 'local' })
	})
	const unlock = fromPromise<string, OperationWork>(({ input, signal }) => {
		const { current, scope, trace } = input
		return unlockCredential(
			{
				version: current.credentialVersion,
				ownerId: current.ownerId,
				organizationId: current.organizationId,
				connectionId: current.id,
				credentialId: current.credentialId,
				prfSalt: current.prfSalt,
				iv: current.iv,
				ciphertext: current.ciphertext
			},
			scope,
			signal,
			trace
		)
	})
	const fetchProvider = fromPromise<ProviderResponse, { work: OperationWork; accessUrl: string }>(
		({ input, signal }) =>
			fetchAccounts(
				input.accessUrl,
				input.work.command.type === 'DISCOVER',
				signal,
				input.work.trace
			)
	)
	const persistOutcome = fromPromise<
		void,
		{
			work: OperationWork
			counts: ImportCounts
			outcome: SyncOutcome
		}
	>(async ({ input, signal }) => {
		signal.throwIfAborted()
		await db
			.update(app.simplefinConnections, input.work.current.id, {
				lastSyncAt: input.work.attemptAt,
				...input.outcome,
				importedCount: input.counts.imported,
				existingCount: input.counts.existing,
				omittedCount: input.counts.omitted
			})
			.wait({ tier: 'local' })
	})
	const actors = {
		lock: bankLock,
		prepare: createPreparationMachine(dependencies),
		authorize: createAuthorizationMachine(dependencies),
		disconnect,
		unlock,
		fetchProvider,
		mapAccounts: createAccountMappingMachine(dependencies),
		importTransactions: createImportMachine(dependencies),
		persistOutcome
	}
	const workflow = setup<
		Context,
		LockEvent | ProgressEvent | ErrorActorEvent | { type: 'CANCEL' },
		typeof actors,
		{},
		{},
		{ mappingCancelling: undefined; mappingFailing: undefined },
		never,
		string,
		Input,
		OperationResult,
		EventObject,
		BankViewMeta
	>({
		actors,
		guards: {
			mappingCancelling: stateIn({ mapping: 'cancelling' }),
			mappingFailing: stateIn({ mapping: 'failing' })
		}
	})
	const failure = (context: Context, error: unknown) => {
		context.work?.trace.failed('operation.failed', error)
		return { error, accessUrl: undefined }
	}
	const failed = workflow.assign(({ context, event }) =>
		failure(context, 'error' in event ? event.error : new Error('failure'))
	)
	const failWith = (code: 'unlock_failure' | 'provider_failure') =>
		workflow.assign(({ context }) => failure(context, new Error(code)))
	const clear = workflow.assign({
		work: undefined,
		accessUrl: undefined,
		response: undefined,
		outcome: undefined
	})
	return workflow.createMachine({
		id: 'bank-operation',
		initial: 'locking',
		context: ({ input }) => {
			const observation = observe()
			return {
				...input,
				identity: input.identity ?? {
					userId: observation.userId,
					organizationId: observation.organizationId
				},
				work: undefined,
				accessUrl: undefined,
				response: undefined,
				counts: emptyCounts(),
				accountResults: [],
				result: undefined,
				completion: undefined,
				error: undefined,
				importSettlement: 'settled',
				writeSettlement: 'settled',
				outcome: undefined
			}
		},
		output: ({ context }) => ({
			...required(context.completion),
			accountResults: context.accountResults
		}),
		invoke: {
			src: 'lock',
			input: ({ context }) => ({
				ownerId: context.identity.userId,
				organizationId: context.identity.organizationId
			}),
			onError: { target: '.settlingFailure', actions: failed }
		},
		on: {
			CANCEL: { target: '.cancelled' },
			LOCK_FAILED: { target: '.settlingFailure', actions: failed },
			IMPORT_PROGRESS: {
				actions: [assign({ counts: ({ event }) => event.counts }), sendParent(({ event }) => event)]
			}
		},
		states: {
			locking: {
				on: { LOCK_ACQUIRED: 'preparing' }
			},
			preparing: {
				invoke: {
					src: 'prepare',
					input: ({ context }) => ({ identity: context.identity, requireConnection: true }),
					onDone: [
						{
							guard: ({ event }) => !event.output.ok,
							target: 'settlingFailure',
							actions: assign({
								error: ({ event }) => (event.output.ok ? undefined : event.output.error)
							})
						},
						{
							target: 'choosingOperation',
							actions: assign({
								work: ({ context, event }) => {
									const prepared = required(event.output.ok ? event.output.value : undefined)
									return {
										command: context.command,
										current: required(prepared.connection),
										scope: prepared.scope,
										trace: createBankTrace(context.command.type),
										attemptAt: new Date()
									}
								}
							})
						}
					],
					onError: { target: 'settlingFailure', actions: failed }
				}
			},
			choosingOperation: {
				always: [
					{
						guard: ({ context }) => context.command.type === 'DISCONNECT',
						target: 'authorizingDisconnect'
					},
					{
						guard: ({ context }) =>
							context.command.type === 'MAP' || context.command.type === 'CREATE_ACCOUNT',
						target: 'authorizingMapping'
					},
					{ target: 'unlocking' }
				]
			},
			disconnecting: {
				initial: 'working',
				entry: assign({ writeSettlement: 'unresolved', response: undefined, accessUrl: undefined }),
				states: {
					working: {},
					cancelling: { on: { CANCEL: {}, LOCK_FAILED: {} } },
					failing: { on: { LOCK_FAILED: {} } }
				},
				on: {
					CANCEL: '.cancelling',
					LOCK_FAILED: { target: '.failing', actions: failed }
				},
				invoke: {
					src: 'disconnect',
					input: ({ context }) => workFor(context),
					onDone: [
						{
							guard: stateIn({ disconnecting: 'cancelling' }),
							target: 'cancelled',
							actions: assign({ writeSettlement: 'settled' })
						},
						{
							guard: stateIn({ disconnecting: 'failing' }),
							target: 'settlingFailure',
							actions: assign({ writeSettlement: 'settled' })
						},
						{ target: 'complete', actions: assign({ writeSettlement: 'settled', result: [] }) }
					],
					onError: [
						{
							guard: stateIn({ disconnecting: 'cancelling' }),
							target: 'cancelled',
							actions: assign({ writeSettlement: 'unresolved' })
						},
						{
							guard: stateIn({ disconnecting: 'failing' }),
							target: 'settlingFailure',
							actions: assign({ writeSettlement: 'unresolved' })
						},
						{
							target: 'settlingFailure',
							actions: [assign({ writeSettlement: 'unresolved' }), failed]
						}
					]
				}
			},
			mapping: {
				entry: assign({ writeSettlement: 'unresolved' }),
				initial: 'working',
				states: {
					working: {},
					cancelling: { on: { CANCEL: {}, LOCK_FAILED: {} } },
					failing: { on: { LOCK_FAILED: {} } }
				},
				on: {
					CANCEL: {
						target: '.cancelling',
						actions: enqueueActions(({ self, enqueue }) => {
							const child = self.getSnapshot().children.mapping
							if (child?.getSnapshot().status === 'active')
								enqueue.sendTo(child, { type: 'CANCEL' })
						})
					},
					LOCK_FAILED: {
						target: '.failing',
						actions: [
							failed,
							enqueueActions(({ self, enqueue }) => {
								const child = self.getSnapshot().children.mapping
								if (child?.getSnapshot().status === 'active')
									enqueue.sendTo(child, { type: 'CANCEL' })
							})
						]
					}
				},
				invoke: {
					id: 'mapping',
					src: 'mapAccounts',
					input: ({ context }) => ({ work: workFor(context), discovered: context.discovered }),
					onDone: [
						{
							guard: 'mappingCancelling',
							target: 'cancelled',
							actions: assign({
								writeSettlement: ({ event }) => (event.output.ok ? 'settled' : 'unresolved')
							})
						},
						{
							guard: 'mappingFailing',
							target: 'settlingFailure',
							actions: assign({
								writeSettlement: ({ event }) => (event.output.ok ? 'settled' : 'unresolved')
							})
						},
						{
							guard: ({ event }) => !event.output.ok,
							target: 'settlingFailure',
							actions: assign({
								error: ({ event }) => (event.output.ok ? undefined : event.output.error)
							})
						},
						{ target: 'complete', actions: assign({ writeSettlement: 'settled' }) }
					],
					onError: [
						{ guard: 'mappingCancelling', target: 'cancelled' },
						{ guard: 'mappingFailing', target: 'settlingFailure' },
						{ target: 'settlingFailure', actions: failed }
					]
				}
			},
			authorizingDisconnect: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(workFor(context)),
					onDone: [
						{
							guard: ({ event }) => event.output.error !== undefined,
							target: 'settlingFailure',
							actions: assign({ error: ({ event }) => event.output.error })
						},
						{ target: 'disconnecting' }
					],
					onError: { target: 'settlingFailure', actions: failed }
				}
			},
			authorizingMapping: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(workFor(context)),
					onDone: [
						{
							guard: ({ event }) => event.output.error !== undefined,
							target: 'settlingFailure',
							actions: assign({ error: ({ event }) => event.output.error })
						},
						{ target: 'mapping' }
					],
					onError: { target: 'settlingFailure', actions: failed }
				}
			},
			unlocking: {
				meta: { loadingProvider: true },
				invoke: {
					src: 'unlock',
					input: ({ context }) => workFor(context),
					onDone: {
						target: 'authorizingFetch',
						actions: assign({ accessUrl: ({ event }) => event.output })
					},
					onError: {
						target: 'preparingFailure',
						actions: [
							({ context, event }) =>
								context.work?.trace.failed('credential.unlock.failed', event.error),
							failWith('unlock_failure')
						]
					}
				}
			},
			authorizingFetch: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(workFor(context)),
					onDone: [
						{
							guard: ({ event }) => event.output.error !== undefined,
							target: 'settlingFailure',
							actions: assign({ error: ({ event }) => event.output.error, accessUrl: undefined })
						},
						{ target: 'fetching' }
					],
					onError: { target: 'settlingFailure', actions: failed }
				}
			},
			fetching: {
				meta: { loadingProvider: true },
				invoke: {
					src: 'fetchProvider',
					input: ({ context }) => {
						if (!context.accessUrl) throw new Error('invalid-credential')
						return { work: workFor(context), accessUrl: context.accessUrl }
					},
					onDone: {
						target: 'authorizingResponse',
						actions: assign({ response: ({ event }) => event.output, accessUrl: undefined })
					},
					onError: { target: 'preparingFailure', actions: failWith('provider_failure') }
				}
			},
			authorizingResponse: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(workFor(context)),
					onDone: [
						{
							guard: ({ event }) => event.output.error !== undefined,
							target: 'settlingFailure',
							actions: assign({ error: ({ event }) => event.output.error })
						},
						{
							guard: ({ context }) => context.command.type === 'DISCOVER',
							target: 'checkingDiscovery'
						},
						{ target: 'importing' }
					],
					onError: { target: 'settlingFailure', actions: failed }
				}
			},
			checkingDiscovery: {
				always: [
					{
						guard: ({ context }) => required(context.response).errors.length > 0,
						target: 'settlingFailure',
						actions: assign({ error: () => new Error('provider_failure') })
					},
					{ target: 'discovering' }
				]
			},
			discovering: {
				entry: assign({
					result: ({ context }) =>
						required(context.response).accounts.map((account) => ({
							id: providerAccountIdentity(account),
							name: account.name,
							currency: account.currency,
							...providerBalanceSnapshot(account)
						}))
				}),
				always: 'complete'
			},
			importing: {
				initial: 'working',
				meta: { loadingProvider: true },
				states: {
					working: {},
					cancelling: { on: { CANCEL: {}, LOCK_FAILED: {} } },
					failing: { on: { LOCK_FAILED: {} } }
				},
				on: {
					CANCEL: {
						target: '.cancelling',
						actions: [
							assign({ accessUrl: undefined, response: undefined }),
							enqueueActions(({ self, enqueue }) => {
								const child = self.getSnapshot().children.import
								if (child?.getSnapshot().status === 'active')
									enqueue.sendTo(child, { type: 'CANCEL' })
							})
						]
					},
					LOCK_FAILED: {
						target: '.failing',
						actions: [
							failed,
							assign({ response: undefined }),
							enqueueActions(({ self, enqueue }) => {
								const child = self.getSnapshot().children.import
								if (child?.getSnapshot().status === 'active')
									enqueue.sendTo(child, { type: 'CANCEL' })
							})
						]
					}
				},
				invoke: {
					id: 'import',
					src: 'importTransactions',
					input: ({ context }) => ({
						work: workFor(context),
						response: required(context.response)
					}),
					onDone: [
						{
							guard: stateIn({ importing: 'cancelling' }),
							target: 'cancelled',
							actions: assign(({ event }) => importCompletion(event.output))
						},
						{
							guard: stateIn({ importing: 'failing' }),
							target: 'settlingFailure',
							actions: assign(({ event }) => importCompletion(event.output))
						},
						{
							guard: ({ event }) => event.output.kind === 'cancelled',
							target: 'cancelled',
							actions: assign(({ event }) => ({
								...importCompletion(event.output),
								error: event.output.error
							}))
						},
						{
							guard: ({ event }) => event.output.kind === 'failed',
							target: 'preparingFailure',
							actions: assign(({ event }) => ({
								...importCompletion(event.output),
								error: event.output.error
							}))
						},
						{
							target: 'classifyingSuccess',
							actions: assign(({ event }) => importCompletion(event.output))
						}
					],
					onError: [
						{
							guard: stateIn({ importing: 'cancelling' }),
							target: 'cancelled',
							actions: assign({ importSettlement: 'unresolved' })
						},
						{
							guard: stateIn({ importing: 'failing' }),
							target: 'settlingFailure',
							actions: assign({ importSettlement: 'unresolved' })
						},
						{
							target: 'recordingFailure',
							actions: [assign({ importSettlement: 'unresolved' }), failed]
						}
					]
				}
			},
			classifyingSuccess: {
				always: [
					{ guard: ({ context }) => context.counts.omitted > 0, target: 'recordingPartial' },
					{
						guard: ({ context }) => (context.response?.errors.length ?? 0) > 0,
						target: 'recordingPartial'
					},
					{ target: 'recordingComplete' }
				]
			},
			recordingComplete: {
				entry: assign({ outcome: { lastOutcome: 'succeeded', lastError: null } }),
				always: 'persistingOutcome'
			},
			recordingPartial: {
				entry: assign({ outcome: { lastOutcome: 'partial', lastError: null } }),
				always: 'persistingOutcome'
			},
			preparingFailure: {
				entry: assign({ accessUrl: undefined }),
				always: [
					{ guard: ({ context }) => context.command.type !== 'SYNC', target: 'settlingFailure' },
					{ target: 'recordingFailure' }
				]
			},
			recordingFailure: {
				entry: assign({ outcome: { lastOutcome: 'failed', lastError: 'operation-failed' } }),
				always: 'persistingOutcome'
			},
			persistingOutcome: {
				initial: 'working',
				entry: assign({ writeSettlement: 'unresolved', response: undefined, accessUrl: undefined }),
				states: {
					working: {},
					cancelling: { on: { CANCEL: {}, LOCK_FAILED: {} } },
					failing: { on: { LOCK_FAILED: {} } }
				},
				on: {
					CANCEL: '.cancelling',
					LOCK_FAILED: { target: '.failing', actions: failed }
				},
				invoke: {
					src: 'persistOutcome',
					input: ({ context }) => ({
						work: workFor(context),
						counts: context.counts,
						outcome: required(context.outcome)
					}),
					onDone: [
						{
							guard: stateIn({ persistingOutcome: 'cancelling' }),
							target: 'cancelled',
							actions: assign({ writeSettlement: 'settled' })
						},
						{
							guard: stateIn({ persistingOutcome: 'failing' }),
							target: 'settlingFailure',
							actions: assign({ writeSettlement: 'settled' })
						},
						{
							guard: ({ context }) => context.outcome?.lastOutcome === 'succeeded',
							target: 'complete',
							actions: assign({ writeSettlement: 'settled' })
						},
						{
							guard: ({ context }) => context.outcome?.lastOutcome === 'partial',
							target: 'partial',
							actions: assign({ writeSettlement: 'settled' })
						},
						{ target: 'settlingFailure', actions: assign({ writeSettlement: 'settled' }) }
					],
					onError: [
						{
							guard: stateIn({ persistingOutcome: 'cancelling' }),
							target: 'cancelled',
							actions: assign({ writeSettlement: 'unresolved' })
						},
						{
							guard: stateIn({ persistingOutcome: 'failing' }),
							target: 'settlingFailure',
							actions: assign({ writeSettlement: 'unresolved' })
						},
						{
							guard: ({ context }) => context.outcome?.lastOutcome === 'failed',
							target: 'settlingFailure',
							actions: assign({ writeSettlement: 'unresolved' })
						},
						{
							target: 'settlingFailure',
							actions: [assign({ writeSettlement: 'unresolved' }), failed]
						}
					]
				}
			},
			settlingFailure: {
				always: [
					{
						guard: ({ context }) =>
							context.error instanceof Error && context.error.message === 'disconnected',
						target: 'cancelled'
					},
					{ target: 'failed' }
				]
			},
			complete: {
				type: 'final',
				entry: [
					assign({
						completion: ({ context }) => ({
							kind: 'complete',
							counts: context.counts,
							discovered: context.result,
							settlement: operationSettlement(context)
						})
					}),
					clear
				]
			},
			partial: {
				type: 'final',
				entry: [
					assign({
						completion: ({ context }) => ({
							kind: 'partial',
							counts: context.counts,
							discovered: context.result,
							settlement: operationSettlement(context)
						})
					}),
					clear
				]
			},
			cancelled: {
				type: 'final',
				entry: [
					assign({
						completion: ({ context }) => ({
							kind: 'cancelled',
							counts: context.counts,
							discovered: context.result,
							settlement: operationSettlement(context),
							error: context.error ?? new Error('disconnected')
						})
					}),
					clear
				]
			},
			failed: {
				type: 'final',
				entry: [
					assign({
						completion: ({ context }) => ({
							kind: 'failed',
							counts: context.counts,
							discovered: context.result,
							settlement: operationSettlement(context),
							error: context.error
						})
					}),
					clear
				]
			}
		}
	})
}
