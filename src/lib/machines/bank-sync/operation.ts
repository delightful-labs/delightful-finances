import type { EventObject } from 'xstate'
import { assign, fromPromise, sendParent, setup } from 'xstate'
import type { ErrorActorEvent } from 'xstate'
import { app } from '#lib/schema.js'
import { createBankTrace } from '#lib/integrations/diagnostics.js'
import { unlockCredential } from '#lib/integrations/passkey.js'
import { fetchAccounts, providerAccountIdentity } from '#lib/integrations/simplefin.js'
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
	type LockEvent,
	type OperationWork,
	type ProgressEvent,
	type ProviderResponse,
	type RequestIdentity,
	type ProviderSummary,
	type BankViewMeta
} from './types.js'

type Input = { command: BankCommand; discovered: ProviderSummary[] }
type Context = Input & {
	identity: RequestIdentity
	work: OperationWork | undefined
	accessUrl: string | undefined
	response: ProviderResponse | undefined
	counts: ImportCounts
	result: ProviderSummary[] | undefined
	completion: OperationResult | undefined
	error: unknown
}
type OperationSummary = { counts: ImportCounts; discovered: ProviderSummary[] | undefined }
export type OperationResult =
	| (OperationSummary & { kind: 'complete' | 'partial' })
	| (OperationSummary & { kind: 'failed' | 'cancelled'; error: unknown })
type SyncOutcome =
	| { lastOutcome: 'succeeded' | 'partial'; lastError: null }
	| { lastOutcome: 'failed'; lastError: 'operation-failed' }

function workFor(context: Context) {
	if (!context.work) throw new Error('missing-command')
	return context.work
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
		{},
		never,
		string,
		Input,
		OperationResult,
		EventObject,
		BankViewMeta
	>({ actors })
	const failure = (context: Context, error: unknown) => {
		context.work?.trace.failed('operation.failed', error)
		return { error, accessUrl: undefined }
	}
	const failed = workflow.assign(({ context, event }) =>
		failure(context, 'error' in event ? event.error : new Error('failure'))
	)
	const failWith = (code: 'unlock_failure' | 'provider_failure') =>
		workflow.assign(({ context }) => failure(context, new Error(code)))
	const clear = workflow.assign({ work: undefined, accessUrl: undefined, response: undefined })
	return workflow.createMachine({
		id: 'bank-operation',
		initial: 'locking',
		context: ({ input }) => {
			const observation = observe()
			return {
				...input,
				identity: { userId: observation.userId, organizationId: observation.organizationId },
				work: undefined,
				accessUrl: undefined,
				response: undefined,
				counts: emptyCounts(),
				result: undefined,
				completion: undefined,
				error: undefined
			}
		},
		output: ({ context }) => required(context.completion),
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
				invoke: {
					src: 'disconnect',
					input: ({ context }) => workFor(context),
					onDone: { target: 'complete', actions: assign({ result: [] }) },
					onError: { target: 'settlingFailure', actions: failed }
				}
			},
			mapping: {
				invoke: {
					src: 'mapAccounts',
					input: ({ context }) => ({ work: workFor(context), discovered: context.discovered }),
					onDone: [
						{
							guard: ({ event }) => !event.output.ok,
							target: 'settlingFailure',
							actions: assign({
								error: ({ event }) => (event.output.ok ? undefined : event.output.error)
							})
						},
						{ target: 'complete' }
					],
					onError: { target: 'settlingFailure', actions: failed }
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
							currency: account.currency
						}))
				}),
				always: 'complete'
			},
			importing: {
				meta: { loadingProvider: true },
				invoke: {
					src: 'importTransactions',
					input: ({ context }) => {
						if (!context.response) throw new Error('missing-response')
						return { work: workFor(context), response: context.response }
					},
					onDone: [
						{
							guard: ({ event }) => event.output.error !== undefined,
							target: 'preparingFailure',
							actions: assign({
								error: ({ event }) => event.output.error,
								counts: ({ event }) => event.output.counts
							})
						},
						{
							target: 'classifyingSuccess',
							actions: assign({ counts: ({ event }) => event.output.counts })
						}
					],
					onError: { target: 'recordingFailure', actions: failed }
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
				invoke: {
					src: 'persistOutcome',
					input: ({ context }) => ({
						work: workFor(context),
						counts: context.counts,
						outcome: { lastOutcome: 'succeeded', lastError: null }
					}),
					onDone: 'complete',
					onError: { target: 'settlingFailure', actions: failed }
				}
			},
			recordingPartial: {
				invoke: {
					src: 'persistOutcome',
					input: ({ context }) => ({
						work: workFor(context),
						counts: context.counts,
						outcome: { lastOutcome: 'partial', lastError: null }
					}),
					onDone: 'partial',
					onError: { target: 'settlingFailure', actions: failed }
				}
			},
			preparingFailure: {
				entry: assign({ accessUrl: undefined }),
				always: [
					{ guard: ({ context }) => context.command.type !== 'SYNC', target: 'settlingFailure' },
					{ target: 'recordingFailure' }
				]
			},
			recordingFailure: {
				invoke: {
					src: 'persistOutcome',
					input: ({ context }) => ({
						work: workFor(context),
						counts: context.counts,
						outcome: { lastOutcome: 'failed', lastError: 'operation-failed' }
					}),
					onDone: 'settlingFailure',
					onError: 'settlingFailure'
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
							discovered: context.result
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
							discovered: context.result
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
							error: context.error
						})
					}),
					clear
				]
			}
		}
	})
}
