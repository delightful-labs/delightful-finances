import {
	assign,
	and,
	not,
	or,
	raise,
	sendParent,
	sendTo,
	setup,
	stateIn,
	type SnapshotFrom,
	type ActorRefFrom
} from 'xstate'
import { createWorkspaceStartupMachine } from './workspace-startup.js'
import {
	createWorkspaceCreationMachine,
	selectWorkspaceCreationReport,
	unavailableWorkspaceCreationView,
	type WorkspaceCreationCommand,
	type WorkspaceCreationView
} from './workspace-creation.js'
import { createWorkspaceNavigationMachine } from './workspace-navigation.js'
import {
	sameInitializationRequest,
	type InitializationRequest,
	type InitializationStatusEvent,
	type WorkspaceRoute,
	type WorkspaceNavigate,
	type WorkspaceNavigationFacts,
	type NavigationAccess,
	type NavigationReport,
	type NavigationStatusEvent
} from '../workspace-orchestration-contract.js'
import { createWorkspaceIntegrityOwner } from './workspace-integrity-owner.js'
import {
	sameIntegrityBinding,
	sameIntegrityRequest,
	selectWorkspaceIntegrityView,
	type IntegrityBinding,
	type IntegrityRequest,
	type IntegrityReport,
	type IntegrityStatusEvent
} from '../workspace-integrity-contract.js'

import type { Organization } from '#lib/schema.js'
import { workspaceRoute } from '../domain/workspace-routes.js'
import { createBankSyncMachine } from './bank-sync/index.js'
import { required } from './bank-sync/identity.js'
import type { BankEvent, BankSource, BankSyncDependencies } from './bank-sync/types.js'

export type ReadinessObservation = {
	source: BankSource
	sessionStatus: 'ready' | 'signed-out' | 'transitioning' | 'error' | 'closed'
	membershipLoading: boolean
	membershipError: unknown
	organizations: readonly Organization[] | undefined
	organizationsLoading: boolean
	organizationsError: unknown
	route: WorkspaceRoute
}
export type WorkspaceAttachment = {
	environment: string
	dependencies: BankSyncDependencies
	read: () => ReadinessObservation
	navigate: WorkspaceNavigate
}
type Context = ReadinessObservation & {
	initializationRequest: InitializationRequest
	navigationFacts: WorkspaceNavigationFacts
	navigationReport: NavigationReport | undefined
	creationView: WorkspaceCreationView
	navigationActor: ActorRefFrom<ReturnType<typeof createWorkspaceNavigationMachine>> | undefined
	integrityRequest: IntegrityRequest
	integrityReport: IntegrityReport | undefined
	creationActor: ActorRefFrom<ReturnType<typeof createWorkspaceCreationMachine>> | undefined
	initialization: { userId: string; profileId: string } | undefined
	integrityActor: ActorRefFrom<ReturnType<typeof createWorkspaceIntegrityOwner>> | undefined
	bankActor: ActorRefFrom<ReturnType<typeof createBankSyncMachine>> | undefined
	startupActor: ActorRefFrom<ReturnType<typeof createWorkspaceStartupMachine>> | undefined
}
type Event =
	| IntegrityStatusEvent
	| InitializationStatusEvent
	| NavigationStatusEvent
	| { type: 'INITIALIZATION_PENDING' }
	| { type: 'OBSERVE_STARTUP'; restart?: true }
	| { type: 'STARTUP_REQUESTED'; restart: boolean }
	| { type: 'OBSERVE_NAVIGATION' }
	| { type: 'NAVIGATION_REQUESTED'; access: NavigationAccess; ready: boolean }
	| { type: 'SELECT_WORKSPACE'; workspaceId: string }
	| { type: 'RETRY_NAVIGATION' }
	| { type: 'CREATION'; event: WorkspaceCreationCommand }
	| { type: 'NAVIGATION_STOPPED' }
	| { type: 'OBSERVE_INTEGRITY'; restart?: true }
	| { type: 'INTEGRITY_REQUESTED'; binding: IntegrityBinding | undefined; restart: boolean }
	| { type: 'OBSERVED'; observation: ReadinessObservation }
	| { type: 'REEVALUATE' }
	| { type: 'BANK'; event: BankEvent }
	| { type: 'SHUTDOWN' }
	| { type: 'RETRY' }
	| { type: 'STARTUP_STOPPED' }
	| { type: 'BANK_STOPPED' }
	| {
			type: 'INTEGRITY_STOPPED' | 'RETRY_INTEGRITY' | 'CREATION_STOPPED' | 'OBSERVE_CREATION'
	  }

export function createWorkspaceReadinessMachine({
	dependencies,
	read,
	environment,
	navigate
}: WorkspaceAttachment) {
	const actors = {
		bank: createBankSyncMachine(dependencies),
		navigation: createWorkspaceNavigationMachine(dependencies.db, navigate),
		startup: createWorkspaceStartupMachine(dependencies.db),
		integrity: createWorkspaceIntegrityOwner(dependencies.db),
		creation: createWorkspaceCreationMachine(dependencies.db)
	}
	return setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{
			navigationAlive: undefined
			navigationReady: undefined
			navigationFailed: undefined
			navigationDenied: undefined
			invalidSelection: undefined
			canUseWorkspace: undefined
			workspaceReady: undefined
			closingDrain: undefined
			bankAlive: undefined
			startupAlive: undefined
			integrityAlive: undefined
			canObserveIntegrity: undefined
			canObserveCreation: undefined
			canSync: undefined
			creationAlive: undefined
		}
	>({
		actors,
		guards: {
			navigationAlive: ({ context }) => context.navigationActor?.getSnapshot().status === 'active',
			navigationReady: stateIn({ active: { workspace: 'ready', session: 'ready' } }),
			navigationFailed: or([
				stateIn({ active: { selection: 'failed' } }),
				stateIn({ active: { organization: 'failed' } })
			]),
			invalidSelection: ({ context }) => {
				const scope = workspaceRoute(context.route.search)
				return (
					scope.scoped &&
					(scope.workspaceId === null || scope.workspaceId !== context.source.organizationId)
				)
			},
			navigationDenied: or([
				stateIn({ active: { selection: 'unavailableSelection' } }),
				stateIn({ active: { organization: 'denied' } })
			]),
			canUseWorkspace: stateIn({
				active: {
					workspace: 'ready',
					session: 'ready',
					organization: 'ready',
					selection: 'selected'
				}
			}),
			workspaceReady: stateIn({ active: { workspace: 'ready' } }),
			closingDrain: stateIn({ closing: { intent: 'shutdown' } }),
			bankAlive: ({ context }) => context.bankActor?.getSnapshot().status === 'active',
			startupAlive: ({ context }) => context.startupActor?.getSnapshot().status === 'active',
			integrityAlive: ({ context }) => context.integrityActor?.getSnapshot().status === 'active',
			canSync: and([
				'canUseWorkspace',
				'canObserveIntegrity',
				({ context }) => {
					const report = context.integrityReport
					return (
						report !== undefined &&
						sameIntegrityRequest(report.request, context.integrityRequest) &&
						(report.status.kind === 'complete' ||
							(report.status.kind === 'partial' && report.status.access === 'usable'))
					)
				}
			]),
			creationAlive: ({ context }) => context.creationActor?.getSnapshot().status === 'active',
			canObserveCreation: and([
				stateIn({ active: { session: 'ready', workspace: 'ready' } }),
				({ context }) =>
					context.initialization !== undefined &&
					context.initialization.userId === context.source.userId
			]),
			canObserveIntegrity: and([
				'canUseWorkspace',
				({ context }) =>
					context.initialization !== undefined &&
					context.initialization.userId === context.source.userId
			])
		}
	}).createMachine({
		id: 'workspace-readiness',
		initial: 'active',
		context: () => {
			const observation = read()
			return {
				...observation,
				initialization: undefined,
				initializationRequest: {
					generation: 0,
					userId: observation.source.userId,
					status: observation.sessionStatus
				},
				navigationFacts: {
					...observation.route,
					generation: 0,
					userId: observation.source.userId,
					ready: false,
					loading: true,
					error: undefined,
					organizations: [],
					access: 'waiting'
				},
				navigationReport: undefined,
				creationView: unavailableWorkspaceCreationView,
				integrityRequest: { generation: 0, binding: undefined },
				integrityReport: undefined,
				bankActor: undefined,
				startupActor: undefined,
				integrityActor: undefined,
				creationActor: undefined,
				navigationActor: undefined
			}
		},
		invoke: [
			{
				id: 'bank',
				src: 'bank',
				onDone: { actions: raise({ type: 'BANK_STOPPED' }) },
				onError: { actions: raise({ type: 'BANK_STOPPED' }) }
			},
			{
				id: 'startup',
				src: 'startup',
				input: ({ context, self }) => ({ request: context.initializationRequest, recipient: self }),
				onDone: { actions: raise({ type: 'STARTUP_STOPPED' }) },
				onError: { actions: raise({ type: 'STARTUP_STOPPED' }) }
			},
			{
				id: 'navigation',
				src: 'navigation',
				input: ({ context, self }) => ({ facts: context.navigationFacts, recipient: self }),
				onDone: { actions: raise({ type: 'NAVIGATION_STOPPED' }) },
				onError: { actions: raise({ type: 'NAVIGATION_STOPPED' }) }
			},
			{
				id: 'integrity',
				src: 'integrity',
				input: ({ context, self }) => ({ request: context.integrityRequest, recipient: self }),
				onDone: { actions: raise({ type: 'INTEGRITY_STOPPED' }) },
				onError: { actions: raise({ type: 'INTEGRITY_STOPPED' }) }
			},
			{
				id: 'creation',
				src: 'creation',
				onSnapshot: [
					{ guard: not(stateIn('active')) },
					{
						guard: ({ context, event }) => {
							const { binding } = selectWorkspaceCreationReport(event.snapshot)
							return (
								binding !== undefined &&
								binding.userId === context.source.userId &&
								binding.profileId === context.initialization?.profileId
							)
						},
						actions: assign({
							creationView: ({ event }) => selectWorkspaceCreationReport(event.snapshot).view
						})
					},
					{ actions: assign({ creationView: unavailableWorkspaceCreationView }) }
				],
				input: { binding: undefined },
				onDone: { actions: raise({ type: 'CREATION_STOPPED' }) },
				onError: { actions: raise({ type: 'CREATION_STOPPED' }) }
			}
		],
		on: {
			SHUTDOWN: { target: '.closing.intent.shutdown' },
			RETRY: {
				guard: stateIn({ active: { workspace: 'failed' } }),
				actions: raise({ type: 'OBSERVE_STARTUP', restart: true })
			},
			CREATION: {
				guard: 'canObserveCreation',
				actions: sendTo('creation', ({ event }) => event.event)
			},
			SELECT_WORKSPACE: {
				actions: sendTo('navigation', ({ event }) => ({
					type: 'SELECT',
					workspaceId: event.workspaceId
				}))
			},
			RETRY_NAVIGATION: { actions: sendTo('navigation', { type: 'RETRY' }) },
			OBSERVE_STARTUP: {
				actions: raise(({ event }) => ({
					type: 'STARTUP_REQUESTED',
					restart: event.restart === true
				}))
			},
			STARTUP_REQUESTED: {
				guard: ({ context, event }) =>
					event.restart ||
					context.initializationRequest.userId !== context.source.userId ||
					context.initializationRequest.status !== context.sessionStatus,
				actions: [
					assign({
						initializationRequest: ({ context }) => ({
							generation: context.initializationRequest.generation + 1,
							userId: context.source.userId,
							status: context.sessionStatus
						}),
						initialization: undefined,
						creationView: unavailableWorkspaceCreationView
					}),
					raise({ type: 'INITIALIZATION_PENDING' }),
					sendTo('startup', ({ context }) => ({
						type: 'OBSERVED',
						request: context.initializationRequest
					}))
				]
			},
			OBSERVE_NAVIGATION: [
				{
					guard: not('navigationReady'),
					actions: raise({ type: 'NAVIGATION_REQUESTED', ready: false, access: 'waiting' })
				},
				{
					guard: 'invalidSelection',
					actions: raise({ type: 'NAVIGATION_REQUESTED', ready: true, access: 'denied' })
				},
				{
					guard: 'canUseWorkspace',
					actions: raise({ type: 'NAVIGATION_REQUESTED', ready: true, access: 'ready' })
				},
				{
					guard: 'navigationFailed',
					actions: raise({ type: 'NAVIGATION_REQUESTED', ready: true, access: 'failed' })
				},
				{
					guard: 'navigationDenied',
					actions: raise({ type: 'NAVIGATION_REQUESTED', ready: true, access: 'denied' })
				},
				{ actions: raise({ type: 'NAVIGATION_REQUESTED', ready: true, access: 'waiting' }) }
			],
			NAVIGATION_REQUESTED: {
				actions: [
					assign({
						navigationFacts: ({ context, event }) => ({
							...context.route,
							generation: context.navigationFacts.generation + 1,
							userId: context.source.userId,
							ready: event.ready,
							loading: context.organizationsLoading || context.organizations === undefined,
							error: context.organizationsError,
							organizations: context.organizations ?? [],
							access: event.access
						}),
						navigationReport: undefined
					}),
					sendTo('navigation', ({ context }) => ({
						type: 'OBSERVED',
						facts: context.navigationFacts
					}))
				]
			},
			RETRY_INTEGRITY: {
				guard: ({ context }) => selectWorkspaceIntegrityView(context.integrityReport).canRetry,
				actions: raise({ type: 'OBSERVE_INTEGRITY', restart: true })
			},
			OBSERVE_CREATION: [
				{
					guard: 'canObserveCreation',
					actions: sendTo('creation', ({ context }) => {
						const initialized = required(context.initialization)
						return {
							type: 'OBSERVED',
							binding: {
								...initialized,
								key: JSON.stringify([environment, initialized.userId])
							}
						}
					})
				},
				{
					actions: [
						assign({ creationView: unavailableWorkspaceCreationView }),
						sendTo('creation', { type: 'OBSERVED', binding: undefined })
					]
				}
			],
			OBSERVE_INTEGRITY: [
				{
					guard: 'canObserveIntegrity',
					actions: raise(({ context, event }) => {
						const initialization = required(context.initialization)
						const membership = required(context.source.membership)
						return {
							type: 'INTEGRITY_REQUESTED',
							restart: event.restart === true,
							binding: {
								userId: initialization.userId,
								profileId: initialization.profileId,
								organizationId: required(context.source.organizationId ?? undefined),
								membershipId: membership.id,
								role: membership.role,
								accountAccessMode: membership.accountAccessMode
							}
						}
					})
				},
				{ actions: raise({ type: 'INTEGRITY_REQUESTED', binding: undefined, restart: false }) }
			],
			INTEGRITY_REQUESTED: {
				guard: ({ context, event }) =>
					event.restart || !sameIntegrityBinding(context.integrityRequest.binding, event.binding),
				actions: [
					assign({
						integrityRequest: ({ context, event }) => ({
							generation: context.integrityRequest.generation + 1,
							binding: event.binding
						}),
						integrityReport: undefined
					}),
					sendTo('integrity', ({ context }) => ({
						type: 'OBSERVED',
						request: context.integrityRequest
					}))
				]
			},
			BANK: [
				{
					guard: ({ event }) => event.event.type === 'CANCEL' || event.event.type === 'RESET',
					actions: sendTo('bank', ({ event }) => event.event)
				},
				{
					guard: and(['canSync', ({ event }) => event.event.type === 'SYNC']),
					actions: sendTo('bank', ({ event }) => event.event)
				},
				{
					guard: and(['canUseWorkspace', ({ event }) => event.event.type !== 'SYNC']),
					actions: sendTo('bank', ({ event }) => event.event)
				}
			],
			OBSERVED: {
				actions: [
					assign(({ event }) => event.observation),
					raise({ type: 'OBSERVE_STARTUP' }),
					sendTo('bank', ({ event }) => ({ type: 'OBSERVED', source: event.observation.source })),
					raise({ type: 'REEVALUATE' }),
					raise({ type: 'OBSERVE_INTEGRITY' }),
					raise({ type: 'OBSERVE_CREATION' }),
					raise({ type: 'OBSERVE_NAVIGATION' })
				]
			}
		},
		states: {
			active: {
				type: 'parallel',
				on: {
					NAVIGATION_STATUS: {
						guard: ({ context, event }) =>
							context.navigationFacts.generation === event.report.generation,
						actions: assign({ navigationReport: ({ event }) => event.report })
					},
					INTEGRITY_STATUS: {
						guard: ({ context, event }) =>
							sameIntegrityRequest(context.integrityRequest, event.report.request),
						actions: assign({ integrityReport: ({ event }) => event.report })
					},
					NAVIGATION_STOPPED: '#workspace-readiness.closing.intent.failed',
					BANK_STOPPED: '#workspace-readiness.closing.intent.failed',
					STARTUP_STOPPED: '#workspace-readiness.closing.intent.failed',
					INTEGRITY_STOPPED: '#workspace-readiness.closing.intent.failed',
					CREATION_STOPPED: '#workspace-readiness.closing.intent.failed'
				},
				states: {
					session: {
						initial: 'checking',
						on: { REEVALUATE: '.checking' },
						states: {
							checking: {
								always: [
									{ guard: ({ context }) => context.sessionStatus === 'error', target: 'failed' },
									{ guard: ({ context }) => context.sessionStatus === 'closed', target: 'closed' },
									{
										guard: ({ context }) => context.sessionStatus === 'signed-out',
										target: 'signedOut'
									},
									{
										guard: ({ context }) => context.sessionStatus === 'transitioning',
										target: 'transitioning'
									},
									{ guard: ({ context }) => Boolean(context.source.userId), target: 'ready' },
									{ target: 'signedOut' }
								]
							},
							ready: {},
							transitioning: {},
							signedOut: {},
							failed: {},
							closed: {}
						}
					},
					workspace: {
						initial: 'waiting',
						on: {
							INITIALIZATION_PENDING: '.waiting',
							INITIALIZATION_STATUS: [
								{
									guard: ({ context, event }) =>
										sameInitializationRequest(
											context.initializationRequest,
											event.report.request
										) && event.report.status.kind === 'ready',
									target: '.ready',
									actions: assign({
										initialization: ({ event }) => {
											if (event.report.status.kind !== 'ready' || !event.report.request.userId)
												throw new Error('Expected ready initialization report')
											return {
												userId: event.report.request.userId,
												profileId: event.report.status.profileId
											}
										}
									})
								},
								{
									guard: ({ context, event }) =>
										sameInitializationRequest(
											context.initializationRequest,
											event.report.request
										) && event.report.status.kind === 'failed',
									target: '.failed'
								},
								{
									guard: ({ context, event }) =>
										sameInitializationRequest(context.initializationRequest, event.report.request),
									target: '.waiting'
								}
							]
						},
						states: {
							waiting: {
								entry: [
									assign({ initialization: undefined }),
									raise({ type: 'OBSERVE_INTEGRITY' }),
									raise({ type: 'OBSERVE_CREATION' }),
									raise({ type: 'OBSERVE_NAVIGATION' })
								]
							},
							ready: {
								tags: 'workspace-ready',
								entry: [
									raise({ type: 'REEVALUATE' }),
									raise({ type: 'OBSERVE_INTEGRITY' }),
									raise({ type: 'OBSERVE_CREATION' }),
									raise({ type: 'OBSERVE_NAVIGATION' })
								]
							},
							failed: {
								tags: ['workspace-error', 'workspace-retryable'],
								entry: [
									assign({ initialization: undefined }),
									raise({ type: 'OBSERVE_INTEGRITY' }),
									raise({ type: 'OBSERVE_CREATION' }),
									raise({ type: 'OBSERVE_NAVIGATION' })
								]
							}
						}
					},
					selection: {
						initial: 'checking',
						on: { REEVALUATE: '.checking' },
						states: {
							checking: {
								always: [
									{ guard: 'workspaceReady', target: 'checkingQuery' },
									{ target: 'waiting' }
								]
							},
							checkingQuery: {
								always: [
									{ guard: ({ context }) => context.organizationsError != null, target: 'failed' },
									{ guard: ({ context }) => context.organizationsLoading, target: 'waiting' },
									{ guard: ({ context }) => !context.organizations, target: 'waiting' },
									{ target: 'choosingOrganization' }
								]
							},
							choosingOrganization: {
								always: [
									{
										guard: ({ context }) =>
											context.organizations?.some(
												(row) => row.id === context.source.organizationId
											) ?? false,
										target: 'selected'
									},
									{
										guard: ({ context }) => context.source.organizationId != null,
										target: 'unavailableSelection'
									},
									{ target: 'unselected' }
								]
							},
							unselected: {},
							unavailableSelection: {},
							selected: {},
							waiting: {},
							failed: {}
						}
					},
					organization: {
						initial: 'checking',
						on: { REEVALUATE: '.checking' },
						states: {
							checking: {
								always: [
									{
										guard: ({ context }) => context.sessionStatus !== 'ready',
										target: 'unavailable'
									},
									{ guard: ({ context }) => !context.source.organizationId, target: 'unselected' },
									{ guard: ({ context }) => context.membershipError != null, target: 'failed' },
									{
										guard: ({ context }) => context.membershipLoading,
										target: 'loadingMembership'
									},
									{ target: 'checkingMembership' }
								]
							},
							checkingMembership: {
								always: [
									{ guard: ({ context }) => !context.source.membership, target: 'denied' },
									{
										guard: ({ context }) =>
											context.source.membership?.userId !== context.source.userId,
										target: 'denied'
									},
									{
										guard: ({ context }) =>
											context.source.membership?.organizationId !== context.source.organizationId,
										target: 'denied'
									},
									{ target: 'ready' }
								]
							},
							unavailable: { entry: sendTo('bank', { type: 'CANCEL' }) },
							unselected: { entry: sendTo('bank', { type: 'CANCEL' }) },
							loadingMembership: { entry: sendTo('bank', { type: 'CANCEL' }) },
							denied: { entry: sendTo('bank', { type: 'CANCEL' }) },
							failed: { entry: sendTo('bank', { type: 'CANCEL' }) },
							ready: {}
						}
					}
				}
			},
			closing: {
				type: 'parallel',
				entry: assign({
					integrityReport: undefined,
					navigationReport: undefined,
					creationView: unavailableWorkspaceCreationView,
					navigationActor: ({ self }) => self.getSnapshot().children.navigation,
					bankActor: ({ self }) => self.getSnapshot().children.bank,
					startupActor: ({ self }) => self.getSnapshot().children.startup,
					integrityActor: ({ self }) => self.getSnapshot().children.integrity,
					creationActor: ({ self }) => self.getSnapshot().children.creation
				}),
				on: {
					CREATION: {},
					SELECT_WORKSPACE: {},
					RETRY_NAVIGATION: {},
					OBSERVE_STARTUP: {},
					STARTUP_REQUESTED: {},
					OBSERVE_NAVIGATION: {},
					NAVIGATION_REQUESTED: {},
					INITIALIZATION_STATUS: {},
					INITIALIZATION_PENDING: {},
					BANK: {},
					OBSERVED: {},
					REEVALUATE: {},
					RETRY: {},
					RETRY_INTEGRITY: {},
					OBSERVE_INTEGRITY: {},
					INTEGRITY_REQUESTED: {},
					OBSERVE_CREATION: {},

					SHUTDOWN: '.intent.shutdown'
				},
				states: {
					intent: {
						initial: 'failed',
						states: { failed: { type: 'final' }, shutdown: { type: 'final' } }
					},
					navigation: {
						initial: 'checking',
						states: {
							checking: {
								always: [{ guard: 'navigationAlive', target: 'stopping' }, { target: 'stopped' }]
							},
							stopping: {
								entry: sendTo('navigation', { type: 'SHUTDOWN' }),
								on: { NAVIGATION_STOPPED: 'stopped' }
							},
							stopped: { type: 'final' }
						}
					},
					bank: {
						initial: 'checking',
						states: {
							checking: {
								always: [{ guard: 'bankAlive', target: 'stopping' }, { target: 'stopped' }]
							},
							stopping: {
								entry: sendTo('bank', { type: 'SHUTDOWN' }),
								on: { BANK_STOPPED: 'stopped' }
							},
							stopped: { type: 'final' }
						}
					},
					creation: {
						initial: 'checking',
						states: {
							checking: {
								always: [{ guard: 'creationAlive', target: 'stopping' }, { target: 'stopped' }]
							},
							stopping: {
								entry: sendTo('creation', { type: 'SHUTDOWN' }),
								on: { CREATION_STOPPED: 'stopped' }
							},
							stopped: { type: 'final' }
						}
					},
					integrity: {
						initial: 'checking',
						states: {
							checking: {
								always: [{ guard: 'integrityAlive', target: 'stopping' }, { target: 'stopped' }]
							},
							stopping: {
								entry: sendTo('integrity', { type: 'SHUTDOWN' }),
								on: { INTEGRITY_STOPPED: 'stopped' }
							},
							stopped: { type: 'final' }
						}
					},
					startup: {
						initial: 'checking',
						states: {
							checking: {
								always: [{ guard: 'startupAlive', target: 'stopping' }, { target: 'stopped' }]
							},
							stopping: {
								entry: sendTo('startup', { type: 'SHUTDOWN' }),
								on: { STARTUP_STOPPED: 'stopped' }
							},
							stopped: { type: 'final' }
						}
					}
				},
				onDone: [{ guard: 'closingDrain', target: 'closed' }, { target: 'failed' }]
			},
			failed: {
				tags: 'workspace-error',
				on: {
					CREATION: {},
					SELECT_WORKSPACE: {},
					RETRY_NAVIGATION: {},
					OBSERVE_STARTUP: {},
					STARTUP_REQUESTED: {},
					OBSERVE_NAVIGATION: {},
					NAVIGATION_REQUESTED: {},
					INITIALIZATION_STATUS: {},
					INITIALIZATION_PENDING: {},
					SHUTDOWN: 'closed',
					BANK: {},
					OBSERVED: {},
					REEVALUATE: {},
					RETRY: {},
					OBSERVE_INTEGRITY: {},
					INTEGRITY_REQUESTED: {},
					OBSERVE_CREATION: {},
					RETRY_INTEGRITY: {}
				}
			},
			closed: {
				type: 'final',
				entry: sendParent(({ self }) => ({ type: 'WORKSPACE_CLOSED', actor: self }))
			}
		}
	})
}

export type WorkspaceCoordinatorSnapshot = SnapshotFrom<
	ReturnType<typeof createWorkspaceReadinessMachine>
>
export type WorkspaceCoordinatorActor = ActorRefFrom<
	ReturnType<typeof createWorkspaceReadinessMachine>
>
export function selectWorkspaceView(snapshot: WorkspaceCoordinatorSnapshot | undefined) {
	return {
		ready:
			snapshot?.hasTag('workspace-ready') === true &&
			snapshot.matches({ active: { session: 'ready' } }),
		failed: snapshot?.hasTag('workspace-error') ?? false,
		canRetry: snapshot?.hasTag('workspace-retryable') ?? false,
		canSync: snapshot?.can({ type: 'BANK', event: { type: 'SYNC' } }) ?? false,
		navigation: snapshot?.context.navigationReport?.status ?? 'waiting',
		creation: snapshot?.context.creationView ?? unavailableWorkspaceCreationView,
		integrity: selectWorkspaceIntegrityView(snapshot?.context.integrityReport)
	}
}
/** Public actor reference for integration subscriptions; bank workflow internals stay encapsulated. */
export function workspaceBankActor(snapshot: WorkspaceCoordinatorSnapshot) {
	return snapshot.children.bank
}
