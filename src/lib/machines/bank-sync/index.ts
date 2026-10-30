import { m } from '#lib/paraglide/messages.js'
import type { BankPresentation } from '#lib/bank-presentation-contract.js'
import type { ActorRefFrom, EventObject, SnapshotFrom } from 'xstate'
import { and, assign, not, or, raise, sendTo, setup, stateIn } from 'xstate'
import {
	bankAvailabilityMachine,
	selectedBankConnection,
	type AvailabilityEvent,
	type AvailabilityReport
} from './availability.js'
import { accountOptionsMachine, type ProviderAccountView } from './account-options.js'
import { bankHistoryMachine, type HistoryEvent } from './history.js'
import { required } from './identity.js'
import { createBankSetupMachine } from './setup.js'
import { createBankOperationMachine } from './operation.js'
import {
	bankCredentialFingerprint,
	bankObservation,
	bankViewMetadata,
	bankSetupSteps,
	type BankSyncDependencies,
	type BankAccess,
	type BankCredential,
	type BankObservationEvent,
	type LastSync,
	type BankData,
	bankErrorCode,
	emptyCounts,
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
	| AvailabilityEvent
	| HistoryEvent
	| ProgressEvent
	| BankObservationEvent
	| { type: 'SHUTDOWN' }
	| { type: `xstate.error.actor.${string}`; error: unknown }
type Context = BankData & {
	access: BankAccess
	revision: number
	connection: BankCredential | undefined
	generation: number
	lastSync: LastSync | undefined
	mappingActors: ReadonlyMap<string, ActorRefFrom<typeof accountOptionsMachine>>
	availability: AvailabilityReport | undefined
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
		{
			isNeutral: undefined
			newAccess: undefined
			newCredentials: undefined
			canConnect: undefined
			canOperate: undefined
			acceptObservations: undefined
		},
		never,
		string,
		unknown,
		unknown,
		EventObject,
		BankViewMeta
	>({
		actors,
		guards: {
			acceptObservations: not(
				or([stateIn({ setup: 'shuttingDown' }), stateIn({ running: 'shuttingDown' })])
			),
			isNeutral: stateIn({ ready: 'neutral' }),
			newAccess: and([
				'acceptObservations',
				({ context, event }) =>
					event.type === 'WORKSPACE_ACCESS_CHANGED' && event.revision > context.revision
			]),
			newCredentials: and([
				'acceptObservations',
				({ context, event }) =>
					event.type === 'CONNECTIONS_CHANGED' &&
					event.revision === context.revision &&
					bankCredentialFingerprint(context.connection) !==
						bankCredentialFingerprint(
							selectedBankConnection({ ...context.access, connections: event.connections })
						)
			]),
			canConnect: ({ context }) => context.availability?.canConnect === true,
			canOperate: ({ context }) => context.availability?.canOperate === true
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
	const resetResults = workflow.enqueueActions(({ enqueue }) => {
		enqueue.assign({ discovered: [], error: undefined, counts: emptyCounts() })
		enqueue(refreshMappings)
	})
	const acceptAccess = workflow.enqueueActions(({ context, event, enqueue }) => {
		if (event.type !== 'WORKSPACE_ACCESS_CHANGED') return
		enqueue.assign({
			access: event.access,
			revision: event.revision,
			generation: context.generation + 1,
			connection: undefined,
			accounts: [],
			mappings: new Map(),
			lastSync: undefined,
			availability: undefined
		})
		enqueue(resetResults)
		enqueue.sendTo('availability', ({ context }) => ({
			type: 'ACCESS_CHANGED',
			access: context.access,
			generation: context.generation
		}))
		enqueue.sendTo('history', { type: 'BINDING_CHANGED', revision: event.revision })
	})
	const acceptConnections = workflow.enqueueActions(({ context, event, enqueue }) => {
		if (event.type !== 'CONNECTIONS_CHANGED') return
		const connection = selectedBankConnection({ ...context.access, connections: event.connections })
		enqueue.assign({
			connection,
			generation: context.generation + 1,
			availability: undefined,
			discovered: []
		})
		enqueue(refreshMappings)
		enqueue.sendTo('availability', ({ context }) => ({
			type: 'CONNECTION_CHANGED',
			connection: context.connection,
			generation: context.generation
		}))
		if (connection?.id !== context.connection?.id) {
			enqueue.assign({ lastSync: undefined })
			enqueue.sendTo('history', {
				type: 'CONNECTION_SELECTED',
				revision: context.revision,
				connectionId: connection?.id
			})
		}
	})
	const cancelSetup = workflow.enqueueActions(({ self, enqueue }) => {
		const child = self.getSnapshot().children.setup
		if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'CANCEL' })
	})
	const notifySetupCredential = workflow.enqueueActions(({ context, self, enqueue }) => {
		const child = self.getSnapshot().children.setup
		if (child?.getSnapshot().status === 'active')
			enqueue.sendTo(child, {
				type: 'CREDENTIAL_CHANGED',
				fingerprint: bankCredentialFingerprint(context.connection)
			})
	})
	const acceptAvailability = workflow.assign(({ context, event }) => ({
		availability: event.type === 'AVAILABILITY_REPORTED' ? event.report : context.availability
	}))
	return workflow.createMachine({
		id: 'bank',
		initial: 'ready',
		meta: { setupStep: 0 },
		invoke: [
			{
				id: 'availability',
				src: 'availability',
				input: ({ context, self }) => ({
					organizationId: null,
					userId: undefined,
					sessionReady: false,
					membership: undefined,
					connections: [],
					generation: context.generation,
					recipient: self
				}),
				onError: { actions: raise({ type: 'SHUTDOWN' }) }
			},
			{
				id: 'history',
				src: 'history',
				input: ({ context, self }) => ({
					revision: context.revision,
					recipient: self
				}),
				onError: { actions: raise({ type: 'SHUTDOWN' }) }
			}
		],
		context: () => {
			return {
				accounts: [],
				mappings: new Map(),
				access: { kind: 'waiting', organizationId: null, userId: undefined },
				revision: -1,
				connection: undefined,
				generation: 0,
				lastSync: undefined,
				mappingActors: new Map(),
				availability: undefined,
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
			WORKSPACE_ACCESS_CHANGED: {
				guard: 'newAccess',
				target: '.ready.neutral',
				actions: acceptAccess
			},
			CONNECTIONS_CHANGED: { guard: 'newCredentials', actions: acceptConnections },
			MAPPING_DATA_CHANGED: {
				guard: and([
					'acceptObservations',
					({ context, event }) => event.revision === context.revision
				]),
				actions: [assign(({ event }) => event.data), refreshMappings]
			},
			HISTORY_CHANGED: {
				guard: and([
					'acceptObservations',
					({ context, event }) => event.revision === context.revision
				]),
				actions: sendTo('history', ({ event }) => event)
			},
			HISTORY_REPORTED: {
				guard: and([
					'acceptObservations',
					({ context, event }) =>
						event.revision === context.revision && event.connectionId === context.connection?.id
				]),
				actions: assign({ lastSync: ({ event }) => event.summary })
			},
			AVAILABILITY_REPORTED: [
				{
					guard: and([
						'acceptObservations',
						'isNeutral',
						({ context, event }) => event.report.generation === context.generation
					]),
					target: '.ready.neutral',
					actions: acceptAvailability
				},
				{
					guard: and([
						'acceptObservations',
						({ context, event }) => event.report.generation === context.generation
					]),
					actions: acceptAvailability
				}
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
									{
										guard: ({ context }) => context.access.kind !== 'allowed',
										target: 'restricted'
									},
									{
										guard: ({ context }) => context.availability?.mode === 'connected',
										target: 'locked'
									},
									{
										guard: ({ context }) => context.connection?.status === 'active',
										target: 'waiting'
									},
									{ target: 'disconnected' }
								]
							},
							disconnected: {
								meta: {
									status: {
										key: 'bank.idle_step',
										label: () => m['bank.idle_step']({ step: bankSetupSteps[0].label() })
									}
								}
							},
							locked: { meta: { status: { key: 'bank.locked', label: () => m['bank.locked']() } } },
							waiting: {
								meta: { status: { key: 'bank.waiting', label: () => m['bank.waiting']() } }
							},
							restricted: {
								meta: { status: { key: 'bank.restricted', label: () => m['bank.restricted']() } }
							}
						}
					},
					success: {
						initial: 'complete',
						states: {
							complete: {
								meta: { status: { key: 'bank.success', label: () => m['bank.success']() } }
							},
							partial: {
								meta: {
									status: { key: 'bank.partial_success', label: () => m['bank.partial_success']() }
								}
							}
						}
					},
					cancelled: {
						meta: { status: { key: 'bank.cancelled', label: () => m['bank.cancelled']() } }
					},
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
							modeMismatch: {
								meta: {
									status: { key: 'bank.mode_mismatch', label: () => m['bank.mode_mismatch']() }
								}
							},
							passkey: {
								meta: {
									status: { key: 'bank.passkey_failure', label: () => m['bank.passkey_failure']() }
								}
							},
							claim: {
								meta: {
									status: { key: 'bank.claim_failure', label: () => m['bank.claim_failure']() }
								}
							},
							invalidToken: {
								meta: {
									status: {
										key: 'bank.invalid_setup_token',
										label: () => m['bank.invalid_setup_token']()
									}
								}
							},
							accountConflict: {
								meta: {
									status: {
										key: 'bank.account_already_linked',
										label: () => m['bank.account_already_linked']()
									}
								}
							},
							save: {
								meta: {
									status: { key: 'bank.save_failure', label: () => m['bank.save_failure']() }
								}
							},
							otherTab: {
								meta: { status: { key: 'bank.other_tab', label: () => m['bank.other_tab']() } }
							},
							lockingUnavailable: {
								meta: {
									status: {
										key: 'bank.locking_unavailable',
										label: () => m['bank.locking_unavailable']()
									}
								}
							},
							unlock: {
								meta: {
									status: { key: 'bank.unlock_failure', label: () => m['bank.unlock_failure']() }
								}
							},
							provider: {
								meta: {
									status: {
										key: 'bank.provider_failure',
										label: () => m['bank.provider_failure']()
									}
								}
							},
							mapping: {
								meta: {
									status: { key: 'bank.mapping_failure', label: () => m['bank.mapping_failure']() }
								}
							},
							unexpected: {
								meta: { status: { key: 'bank.failure', label: () => m['bank.failure']() } }
							}
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
					resetting: {
						on: {
							CANCEL: {},
							CONNECTIONS_CHANGED: { guard: 'newCredentials', actions: acceptConnections }
						}
					},
					shuttingDown: { on: { CANCEL: {}, RESET: {}, SHUTDOWN: {} } }
				},
				tags: ['setup', 'busy'],
				meta: {
					status: { key: 'bank.working', label: () => m['bank.working']() },
					setupView: 'creating',
					setupStep: 1
				},
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
					WORKSPACE_ACCESS_CHANGED: {
						guard: 'newAccess',
						target: '.resetting',
						actions: [acceptAccess, cancelSetup]
					},
					SHUTDOWN: { target: '.shuttingDown', actions: cancelSetup },
					RESET: {
						target: '.resetting',
						actions: [assign({ discovered: [] }), refreshMappings, cancelSetup]
					},
					CANCEL: { target: '.cancelling', actions: cancelSetup },
					CONNECTIONS_CHANGED: {
						guard: 'newCredentials',
						actions: [acceptConnections, notifySetupCredential]
					},
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
					resetting: {
						on: {
							CANCEL: {},
							IMPORT_PROGRESS: {},
							CONNECTIONS_CHANGED: { guard: 'newCredentials', actions: acceptConnections }
						}
					},
					shuttingDown: {
						on: {
							CANCEL: {},
							RESET: {},
							SHUTDOWN: {},
							IMPORT_PROGRESS: {}
						}
					}
				},
				tags: ['operating', 'busy'],
				meta: { status: { key: 'bank.working', label: () => m['bank.working']() } },
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
					WORKSPACE_ACCESS_CHANGED: {
						guard: 'newAccess',
						target: '.resetting',
						actions: [acceptAccess, cancelOperation]
					},
					SHUTDOWN: { target: '.shuttingDown', actions: cancelOperation },
					RESET: {
						target: '.resetting',
						actions: [assign({ discovered: [] }), refreshMappings, cancelOperation]
					},
					CANCEL: { target: '.cancelling', actions: cancelOperation },
					CONNECTIONS_CHANGED: [
						{
							guard: and([
								'newCredentials',
								({ context }) =>
									context.command?.type === 'SYNC' || context.command?.type === 'DISCOVER'
							]),
							target: '.cancelling',
							actions: [acceptConnections, cancelOperation]
						},
						{ guard: 'newCredentials', actions: acceptConnections }
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
		mode:
			!snapshot.context.availability || snapshot.context.availability.mode === 'restricted'
				? { kind: 'restricted' }
				: snapshot.context.availability.mode === 'setup'
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
