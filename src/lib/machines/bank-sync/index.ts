import type { BankPresentation } from '#lib/bank-presentation-contract.js'
import type { ActorRefFrom, EventObject, SnapshotFrom } from 'xstate'
import { assign, getInitialSnapshot, raise, sendTo, setup, stateIn } from 'xstate'
import { bankAvailabilityMachine, availabilityObservation } from './availability.js'
import { accountOptionsMachine, type ProviderAccountView } from './account-options.js'
import { bankHistoryMachine } from './history.js'
import { required } from './identity.js'
import { createBankSetupMachine } from './setup.js'
import { createBankOperationMachine } from './operation.js'
import {
	bankEnvironment,
	bankObservation,
	bankData,
	bankViewMetadata,
	bankSetupSteps,
	type BankSyncDependencies,
	type BankSource,
	type LastSync,
	type BankData,
	bankErrorCode,
	emptyCounts,
	type BankEnvironment,
	type BankCommand,
	type BankEvent,
	type BankViewMeta,
	type Dependencies,
	type ImportCounts,
	type ProgressEvent,
	type ProviderSummary
} from './types.js'

export type { BankEvent, BankCommand } from './types.js'
type Event =
	| BankEvent
	| ProgressEvent
	| { type: 'OBSERVED'; source: BankSource }
	| { type: 'SHUTDOWN' }
	| { type: `xstate.error.actor.${string}`; error: unknown }
	| {
			type: 'ENVIRONMENT_CHANGED'
			environment: BankEnvironment
			data: BankData
			availability: SnapshotFrom<typeof bankAvailabilityMachine>
	  }
type Context = BankData & {
	lastSync: LastSync | undefined
	mappingActors: ReadonlyMap<string, ActorRefFrom<typeof accountOptionsMachine>>
	availability: SnapshotFrom<typeof bankAvailabilityMachine>
	environment: BankEnvironment
	command: BankCommand | undefined
	setupToken: string | undefined
	error: unknown
	discovered: ProviderSummary[]
	counts: ImportCounts
}

export function createBankSyncMachine(inputs: BankSyncDependencies) {
	const dependencies: Dependencies = {
		db: inputs.db,
		passkeyName: inputs.passkeyName,
		observe: () => bankObservation(inputs.read())
	}
	const actors = {
		history: bankHistoryMachine,
		mappingRow: accountOptionsMachine,
		availability: bankAvailabilityMachine,
		setupConnection: createBankSetupMachine(dependencies),
		operation: createBankOperationMachine(dependencies)
	}
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{ isNeutral: undefined; canConnect: undefined; canOperate: undefined },
		never,
		string,
		unknown,
		unknown,
		EventObject,
		BankViewMeta
	>({
		actors,
		guards: {
			isNeutral: stateIn({ ready: 'neutral' }),
			canConnect: ({ context }) => context.availability.hasTag('allowed'),
			canOperate: ({ context }) => context.availability.hasTag('show-sync')
		}
	})
	const clear = workflow.assign({ command: undefined, setupToken: undefined })
	const cancelOperation = workflow.enqueueActions(({ self, enqueue }) => {
		const child = self.getSnapshot().children.operation
		if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'CANCEL' })
	})
	const refreshMappings = workflow.enqueueActions(({ context, enqueue }) => {
		for (const actor of context.mappingActors.values()) enqueue.stopChild(actor)
		enqueue.assign(({ context, spawn }) => ({
			mappingActors: new Map(
				context.discovered.map((provider) => [
					provider.id,
					spawn('mappingRow', {
						id: `mapping:${provider.id}`,
						input: { provider, accounts: context.accounts, mappings: context.mappings }
					})
				])
			)
		}))
	})
	const assignEnvironment = workflow.assign(({ context, event }) =>
		event.type === 'ENVIRONMENT_CHANGED'
			? {
					environment: event.environment,
					availability: event.availability,
					...event.data,
					discovered:
						context.environment.credentialFingerprint !== event.environment.credentialFingerprint
							? []
							: context.discovered
				}
			: {}
	)
	const updateEnvironment = workflow.enqueueActions(({ enqueue }) => {
		enqueue(assignEnvironment)
		enqueue.sendTo('history', ({ event }) => ({
			type: 'OBSERVED',
			connection:
				event.type === 'ENVIRONMENT_CHANGED' ? event.availability.context.connection : undefined
		}))
		enqueue(refreshMappings)
	})
	return workflow.createMachine({
		id: 'bank',
		initial: 'ready',
		meta: { setupStep: 0 },
		invoke: [
			{
				id: 'availability',
				src: 'availability',
				input: ({ context }) => context.availability.context.source,
				onError: { actions: raise({ type: 'SHUTDOWN' }) },
				onSnapshot: {
					actions: raise(({ event }) => ({
						type: 'ENVIRONMENT_CHANGED',
						availability: event.snapshot,
						environment: bankEnvironment(availabilityObservation(event.snapshot)),
						data: bankData(event.snapshot.context.source)
					}))
				}
			},
			{
				id: 'history',
				src: 'history',
				input: ({ context }) => context.availability.context.connection,
				onError: { actions: raise({ type: 'SHUTDOWN' }) },
				onSnapshot: { actions: assign({ lastSync: ({ event }) => event.snapshot.context.summary }) }
			}
		],
		context: () => {
			const source = inputs.read()
			const availability = getInitialSnapshot(bankAvailabilityMachine, source)
			return {
				...bankData(source),
				lastSync: getInitialSnapshot(bankHistoryMachine, availability.context.connection).context
					.summary,
				mappingActors: new Map(),
				availability,
				environment: bankEnvironment(availabilityObservation(availability)),
				command: undefined,
				setupToken: undefined,
				error: undefined,
				discovered: [],
				counts: emptyCounts()
			}
		},
		on: {
			// Mapping children are pure; active resource owners still settle via SHUTDOWN.
			'xstate.error.actor.*': { actions: raise({ type: 'SHUTDOWN' }) },
			SHUTDOWN: { target: '.closed' },
			OBSERVED: {
				actions: sendTo('availability', ({ event }) => ({ type: 'OBSERVED', source: event.source }))
			},
			ENVIRONMENT_CHANGED: [
				{
					guard: ({ context, event }) =>
						context.environment.scopeKey !== event.environment.scopeKey,
					target: '.ready.neutral',
					actions: [
						clear,
						assign({ error: undefined, discovered: [], counts: emptyCounts() }),
						updateEnvironment
					]
				},
				{
					guard: 'isNeutral',
					target: '.ready.neutral',
					actions: updateEnvironment
				},
				{ actions: updateEnvironment }
			],
			RESET: {
				target: '.ready.neutral',
				actions: [
					clear,
					assign({ error: undefined, discovered: [], counts: emptyCounts() }),
					refreshMappings
				]
			}
		},
		states: {
			ready: {
				initial: 'neutral',
				entry: refreshMappings,
				on: {
					CONNECT: {
						guard: 'canConnect',
						target: '#bank.setup',
						actions: assign({ setupToken: ({ event }) => event.token })
					},
					DISCOVER: {
						guard: 'canOperate',
						target: '#bank.running',
						actions: assign({ command: ({ event }) => event })
					},
					SYNC: {
						guard: 'canOperate',
						target: '#bank.running',
						actions: assign({ command: ({ event }) => event })
					},
					MAP: {
						guard: 'canOperate',
						target: '#bank.running',
						actions: assign({ command: ({ event }) => event })
					},
					CREATE_ACCOUNT: {
						guard: 'canOperate',
						target: '#bank.running',
						actions: assign({ command: ({ event }) => event })
					},
					DISCONNECT: {
						guard: 'canOperate',
						target: '#bank.running',
						actions: assign({ command: ({ event }) => event })
					}
				},
				states: {
					neutral: {
						initial: 'checking',
						states: {
							checking: {
								always: [
									{ guard: ({ context }) => !context.environment.allowed, target: 'restricted' },
									{ guard: ({ context }) => context.environment.connected, target: 'locked' },
									{
										guard: ({ context }) => context.environment.connectionActive,
										target: 'waiting'
									},
									{ target: 'disconnected' }
								]
							},
							disconnected: {
								meta: { status: { key: 'bank.idle', stepKey: bankSetupSteps[0].labelKey } }
							},
							locked: { meta: { status: { key: 'bank.locked' } } },
							waiting: { meta: { status: { key: 'bank.waiting' } } },
							restricted: { meta: { status: { key: 'bank.restricted' } } }
						}
					},
					success: {
						initial: 'complete',
						states: {
							complete: { meta: { status: { key: 'bank.success' } } },
							partial: { meta: { status: { key: 'bank.partial_success' } } }
						}
					},
					cancelled: { meta: { status: { key: 'bank.cancelled' } } },
					failure: {
						initial: 'classifying',
						states: {
							classifying: {
								always: [
									{
										guard: ({ context }) => bankErrorCode(context.error) === 'mode_mismatch',
										target: 'modeMismatch'
									},
									{
										guard: ({ context }) => bankErrorCode(context.error) === 'passkey_failure',
										target: 'passkey'
									},
									{
										guard: ({ context }) => bankErrorCode(context.error) === 'claim_failure',
										target: 'claim'
									},
									{
										guard: ({ context }) => bankErrorCode(context.error) === 'invalid_setup_token',
										target: 'invalidToken'
									},
									{
										guard: ({ context }) =>
											bankErrorCode(context.error) === 'account_already_linked',
										target: 'accountConflict'
									},
									{
										guard: ({ context }) => bankErrorCode(context.error) === 'save_failure',
										target: 'save'
									},
									{
										guard: ({ context }) => bankErrorCode(context.error) === 'other_tab',
										target: 'otherTab'
									},
									{
										guard: ({ context }) => bankErrorCode(context.error) === 'locking_unavailable',
										target: 'lockingUnavailable'
									},
									{
										guard: ({ context }) => bankErrorCode(context.error) === 'unlock_failure',
										target: 'unlock'
									},
									{
										guard: ({ context }) => bankErrorCode(context.error) === 'provider_failure',
										target: 'provider'
									},
									{
										guard: ({ context }) => bankErrorCode(context.error) === 'mapping',
										target: 'mapping'
									},
									{ target: 'unexpected' }
								]
							},
							modeMismatch: { meta: { status: { key: 'bank.mode_mismatch' } } },
							passkey: { meta: { status: { key: 'bank.passkey_failure' } } },
							claim: { meta: { status: { key: 'bank.claim_failure' } } },
							invalidToken: { meta: { status: { key: 'bank.invalid_setup_token' } } },
							accountConflict: { meta: { status: { key: 'bank.account_already_linked' } } },
							save: { meta: { status: { key: 'bank.save_failure' } } },
							otherTab: { meta: { status: { key: 'bank.other_tab' } } },
							lockingUnavailable: { meta: { status: { key: 'bank.locking_unavailable' } } },
							unlock: { meta: { status: { key: 'bank.unlock_failure' } } },
							provider: { meta: { status: { key: 'bank.provider_failure' } } },
							mapping: { meta: { status: { key: 'bank.mapping_failure' } } },
							unexpected: { meta: { status: { key: 'bank.failure' } } }
						}
					}
				}
			},
			closed: {
				type: 'final',
				entry: [
					clear,
					assign({ discovered: [], lastSync: undefined, error: undefined, counts: emptyCounts() }),
					refreshMappings
				]
			},
			setup: {
				initial: 'working',
				states: {
					working: {},
					cancelling: {},
					resetting: { on: { CANCEL: {} } },
					shuttingDown: { on: { CANCEL: {}, RESET: {}, SHUTDOWN: {}, ENVIRONMENT_CHANGED: {} } }
				},
				tags: ['setup', 'busy'],
				meta: { status: { key: 'bank.working' }, setupView: 'creating', setupStep: 1 },
				entry: [assign({ error: undefined }), sendTo('availability', { type: 'SETUP_STARTED' })],
				exit: [clear, sendTo('availability', { type: 'SETUP_ENDED' })],
				invoke: {
					id: 'setup',
					src: 'setupConnection',
					input: ({ context }) => {
						if (!context.setupToken) throw new Error('missing-token')
						return { token: context.setupToken }
					},
					onSnapshot: { actions: assign({ setupToken: undefined }) },
					onDone: [
						{ guard: stateIn({ setup: 'shuttingDown' }), target: 'closed' },
						{
							guard: stateIn({ setup: 'resetting' }),
							target: 'ready.neutral',
							actions: assign({ error: undefined, counts: emptyCounts() })
						},
						{ guard: stateIn({ setup: 'cancelling' }), target: 'ready.cancelled' },
						{
							guard: ({ event }) => event.output.kind === 'cancelled',
							target: 'ready.cancelled'
						},
						{
							guard: ({ event }) => event.output.kind === 'failed',
							target: 'ready.failure',
							actions: assign({
								error: ({ event }) =>
									event.output.kind === 'failed' ? event.output.error : undefined
							})
						},
						{ target: 'ready.success.complete' }
					],
					onError: [
						{ guard: stateIn({ setup: 'shuttingDown' }), target: 'closed' },
						{
							guard: stateIn({ setup: 'resetting' }),
							target: 'ready.neutral',
							actions: assign({ error: undefined, counts: emptyCounts() })
						},
						{
							guard: stateIn({ setup: 'cancelling' }),
							target: 'ready.cancelled',
							actions: assign({ error: undefined })
						},
						{ target: 'ready.failure', actions: assign({ error: ({ event }) => event.error }) }
					]
				},
				on: {
					SHUTDOWN: { target: '.shuttingDown', actions: sendTo('setup', { type: 'CANCEL' }) },
					RESET: {
						target: '.resetting',
						actions: [
							assign({ discovered: [] }),
							refreshMappings,
							sendTo('setup', { type: 'CANCEL' })
						]
					},
					CANCEL: { target: '.cancelling', actions: sendTo('setup', { type: 'CANCEL' }) },
					ENVIRONMENT_CHANGED: [
						{
							guard: ({ context, event }) =>
								context.environment.scopeKey !== event.environment.scopeKey,
							target: '.resetting',
							actions: [
								assign({ discovered: [], counts: emptyCounts() }),
								updateEnvironment,
								sendTo('setup', { type: 'CANCEL' })
							]
						},
						{
							actions: [
								workflow.enqueueActions(({ event, self, enqueue }) => {
									const child = self.getSnapshot().children.setup
									// Completion can precede the parent's queued onDone transition.
									if (
										event.type === 'ENVIRONMENT_CHANGED' &&
										child?.getSnapshot().status === 'active'
									)
										enqueue.sendTo(child, {
											type: 'CREDENTIAL_CHANGED',
											fingerprint: event.environment.credentialFingerprint
										})
								}),
								updateEnvironment
							]
						}
					],
					TEST_ENCRYPTION: { actions: sendTo('setup', { type: 'TEST_ENCRYPTION' }) },
					VERIFY_DECRYPTION: { actions: sendTo('setup', { type: 'VERIFY_DECRYPTION' }) },
					SAVE_CONNECTION: { actions: sendTo('setup', { type: 'SAVE_CONNECTION' }) }
				}
			},
			running: {
				initial: 'working',
				states: {
					working: {},
					cancelling: {},
					resetting: { on: { CANCEL: {}, IMPORT_PROGRESS: {} } },
					shuttingDown: {
						on: {
							CANCEL: {},
							RESET: {},
							SHUTDOWN: {},
							ENVIRONMENT_CHANGED: {},
							IMPORT_PROGRESS: {}
						}
					}
				},
				tags: ['operating', 'busy'],
				meta: { status: { key: 'bank.working' } },
				entry: assign({ error: undefined, counts: emptyCounts() }),
				exit: clear,
				invoke: {
					id: 'operation',
					src: 'operation',
					input: ({ context }) => {
						if (!context.command) throw new Error('missing-command')
						return { command: context.command, discovered: context.discovered }
					},
					// Observe child transitions without mirroring their state into context.
					onSnapshot: {},
					onDone: [
						{ guard: stateIn({ running: 'shuttingDown' }), target: 'closed' },
						{
							guard: stateIn({ running: 'resetting' }),
							target: 'ready.neutral',
							actions: assign({ error: undefined, counts: emptyCounts() })
						},
						{
							guard: stateIn({ running: 'cancelling' }),
							target: 'ready.cancelled',
							actions: assign({ counts: ({ event }) => event.output.counts })
						},
						{
							guard: ({ event }) => event.output.kind === 'cancelled',
							target: 'ready.cancelled',
							actions: assign({
								error: ({ event }) =>
									event.output.kind === 'cancelled' ? event.output.error : undefined,
								counts: ({ event }) => event.output.counts
							})
						},
						{
							guard: ({ event }) => event.output.kind === 'failed',
							target: 'ready.failure',
							actions: assign({
								error: ({ event }) =>
									event.output.kind === 'failed' ? event.output.error : undefined,
								counts: ({ event }) => event.output.counts
							})
						},
						{
							guard: ({ event }) => event.output.kind === 'partial',
							target: 'ready.success.partial',
							actions: assign({
								counts: ({ event }) => event.output.counts,
								discovered: ({ context, event }) => event.output.discovered ?? context.discovered
							})
						},
						{
							target: 'ready.success.complete',
							actions: assign({
								counts: ({ event }) => event.output.counts,
								discovered: ({ context, event }) => event.output.discovered ?? context.discovered
							})
						}
					],
					onError: [
						{ guard: stateIn({ running: 'shuttingDown' }), target: 'closed' },
						{
							guard: stateIn({ running: 'resetting' }),
							target: 'ready.neutral',
							actions: assign({ error: undefined, counts: emptyCounts() })
						},
						{
							guard: stateIn({ running: 'cancelling' }),
							target: 'ready.cancelled',
							actions: assign({ error: undefined })
						},
						{ target: 'ready.failure', actions: assign({ error: ({ event }) => event.error }) }
					]
				},
				on: {
					SHUTDOWN: { target: '.shuttingDown', actions: cancelOperation },
					RESET: {
						target: '.resetting',
						actions: [assign({ discovered: [] }), refreshMappings, cancelOperation]
					},
					CANCEL: { target: '.cancelling', actions: cancelOperation },
					ENVIRONMENT_CHANGED: [
						{
							guard: ({ context, event }) =>
								context.environment.scopeKey !== event.environment.scopeKey,
							target: '.resetting',
							actions: [assign({ discovered: [] }), updateEnvironment, cancelOperation]
						},
						{
							guard: ({ context, event }) =>
								context.environment.credentialFingerprint !==
									event.environment.credentialFingerprint &&
								(context.command?.type === 'SYNC' || context.command?.type === 'DISCOVER'),
							target: '.cancelling',
							actions: [updateEnvironment, cancelOperation]
						},
						{ actions: updateEnvironment }
					],
					IMPORT_PROGRESS: { actions: assign({ counts: ({ event }) => event.counts }) }
				}
			}
		}
	})
}

// Select presentation data from the current machine and its active child states.
export function selectBankView(snapshot: SnapshotFrom<ReturnType<typeof createBankSyncMachine>>) {
	const metadata = bankViewMetadata(
		snapshot,
		snapshot.children.setup?.getSnapshot(),
		snapshot.children.operation?.getSnapshot()
	)
	return {
		mode: snapshot.context.availability.hasTag('show-restricted')
			? { kind: 'restricted' }
			: snapshot.context.availability.hasTag('show-setup')
				? {
						kind: 'setup',
						step: metadata.setupStep ?? 0,
						stage: snapshot.matches('setup') ? (metadata.setupView ?? null) : null
					}
				: { kind: 'connected', recovery: 'available' },
		activity: snapshot.hasTag('busy')
			? { kind: 'working', indicator: metadata.loadingProvider ? 'provider' : 'general' }
			: { kind: 'idle' },
		status: snapshot.hasTag('setup') ? undefined : metadata.status,
		history: snapshot.context.lastSync,

		providerAccounts: Array.from(
			snapshot.context.mappingActors.values(),
			(actor): ProviderAccountView => {
				const row = actor.getSnapshot()
				return {
					...row.context.provider,
					mapping: required(row.context.mapping),
					selectedAccountId: row.context.selectedAccountId,
					availableAccounts: row.context.eligibleAccounts,
					showExisting: row.hasTag('show-existing')
				}
			}
		)
	} satisfies BankPresentation
}
