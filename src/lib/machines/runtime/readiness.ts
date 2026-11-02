import {
	assign,
	enqueueActions,
	and,
	not,
	or,
	raise,
	sendParent,
	sendTo,
	setup,
	stateIn,
	type SnapshotFrom,
	type ActorRefFrom,
	type DoneActorEvent,
	type ErrorActorEvent
} from 'xstate'
import { createWorkspaceStartupMachine } from '../workspaces/workspace-startup.js'
import {
	createWorkspaceCreationMachine,
	selectWorkspaceCreationReport,
	unavailableWorkspaceCreationView,
	type WorkspaceCreationCommand,
	type WorkspaceCreationView
} from '../workspaces/workspace-creation.js'
import { createWorkspaceNavigationMachine } from '../workspaces/workspace-navigation.js'
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
} from '../../contracts/workspace-orchestration-contract.js'
import {
	createWorkspaceSelectedResources,
	selectedResourceBankActor
} from './workspace-selected-resources.js'
import {
	sameWorkspaceLease,
	type SelectedResourceOutput,
	type SelectedResourceCommand,
	type SelectedResourceReport
} from '../../contracts/workspace-selected-resources.js'
import {
	retainResourceRelease,
	type WorkspaceResourceRelease
} from '../../contracts/workspace-resource-release.js'
import type {
	WorkspaceLease,
	WorkspaceSelectionReport
} from 'delightful-local-first/workspace/contracts'
import {
	sameIntegrityBinding,
	sameIntegrityRequest,
	selectWorkspaceIntegrityView,
	type IntegrityBinding,
	type IntegrityRequest,
	type IntegrityReport
} from '../../contracts/workspace-integrity-contract.js'

import type { Organization } from '#lib/schema.js'
import { workspaceRoute } from '../../domain/workspace-routes.js'
import { required } from '../bank-sync/identity.js'
import { canManageBankCredentials } from '../../domain/organization-permissions.js'
import type {
	BankAccess,
	BankEvent,
	BankObservationEvent,
	BankSource,
	BankSyncDependencies
} from '../bank-sync/types.js'

export type ReadinessObservation = {
	source: Pick<BankSource, 'organizationId' | 'userId' | 'membership'>
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
	bankAccess:
		| {
				revision: number
				access: BankAccess
				authority: IntegrityBinding | undefined
		  }
		| undefined
	initializationRequest: InitializationRequest
	navigationFacts: WorkspaceNavigationFacts
	navigationReport: NavigationReport | undefined
	creationView: WorkspaceCreationView
	navigationActor: ActorRefFrom<ReturnType<typeof createWorkspaceNavigationMachine>> | undefined
	integrityRequest: IntegrityRequest
	integrityReport: IntegrityReport | undefined
	creationActor: ActorRefFrom<ReturnType<typeof createWorkspaceCreationMachine>> | undefined
	initialization: { userId: string; profileId: string } | undefined
	resourceActor: ActorRefFrom<ReturnType<typeof createWorkspaceSelectedResources>> | undefined
	resourceLease: WorkspaceLease | undefined
	resourceUserId: string | undefined
	selectionLease: WorkspaceLease | undefined
	selectionStatus: Extract<WorkspaceSelectionReport, { type: 'WORKSPACE_SELECTION' }>['status']
	resourceResult: SelectedResourceOutput | undefined
	resourceRelease: WorkspaceResourceRelease
	bankRevision: number
	startupActor: ActorRefFrom<ReturnType<typeof createWorkspaceStartupMachine>> | undefined
}
type Event =
	| { type: 'SELECTION'; lease: WorkspaceLease | undefined; status: Context['selectionStatus'] }
	| SelectedResourceReport
	| DoneActorEvent<SelectedResourceOutput>
	| ErrorActorEvent
	| InitializationStatusEvent
	| NavigationStatusEvent
	| { type: 'INITIALIZATION_PENDING' }
	| { type: 'OBSERVE_STARTUP'; restart?: true }
	| { type: 'STARTUP_REQUESTED'; restart: boolean }
	| { type: 'OBSERVE_NAVIGATION' }
	| { type: 'OBSERVE_BANK' }
	| {
			type: 'BANK_OBSERVED'
			organizationId: string | null
			userId: string | undefined
			event: Exclude<BankObservationEvent, { type: 'WORKSPACE_ACCESS_CHANGED' }>
	  }
	| { type: 'NAVIGATION_REQUESTED'; access: NavigationAccess; ready: boolean }
	| { type: 'SELECT_WORKSPACE'; workspaceId: string }
	| { type: 'RETRY_NAVIGATION' }
	| { type: 'CREATION'; event: WorkspaceCreationCommand }
	| { type: 'NAVIGATION_STOPPED' }
	| { type: 'OBSERVE_INTEGRITY'; restart?: true }
	| { type: 'INTEGRITY_REQUESTED'; binding: IntegrityBinding | undefined; restart: boolean }
	| { type: 'OBSERVED'; observation: ReadinessObservation }
	| { type: 'REEVALUATE' }
	| { type: 'BANK'; lease?: WorkspaceLease | undefined; event: BankEvent }
	| { type: 'BANK_NETWORK'; lease: WorkspaceLease; offline: boolean }
	| { type: 'SHUTDOWN' }
	| { type: 'RETRY' }
	| { type: 'STARTUP_STOPPED' }
	| { type: 'RESOURCES_STOPPED' }
	| {
			type: 'RETRY_INTEGRITY' | 'CREATION_STOPPED' | 'OBSERVE_CREATION'
	  }

export function createWorkspaceReadinessMachine({
	dependencies,
	read,
	environment,
	navigate
}: WorkspaceAttachment) {
	const actors = {
		navigation: createWorkspaceNavigationMachine(dependencies.db, navigate),
		startup: createWorkspaceStartupMachine(dependencies.db),
		creation: createWorkspaceCreationMachine(dependencies.db)
	}
	return setup<
		Context,
		Event,
		typeof actors,
		{},
		{
			publishBank: undefined
			startResources: undefined
			shutDownResources: undefined
			releaseResources: undefined
			failResources: undefined
		},
		{
			bankAccessAllowed: undefined
			navigationAlive: undefined
			navigationReady: undefined
			navigationCanUseWorkspace: undefined
			awaitingInitialWorkspace: undefined
			navigationFailed: undefined
			navigationDenied: undefined
			invalidSelection: undefined
			canUseWorkspace: undefined
			workspaceReady: undefined
			closingDrain: undefined
			resourceBound: undefined
			resourceMatches: undefined
			resourceEligible: undefined
			nativeAssessmentSettled: undefined
			startupAlive: undefined
			canObserveIntegrity: undefined
			canObserveCreation: undefined
			creationAlive: undefined
		},
		never,
		string,
		unknown,
		{ selectedResources: WorkspaceResourceRelease }
	>({
		actors,
		actions: {
			startResources: assign(({ context, self, spawn }) => {
				const resourceLease = required(context.selectionLease)
				return {
					resourceLease,
					resourceUserId: context.source.userId,
					resourceResult: undefined,
					bankAccess: undefined,
					integrityReport: undefined,
					resourceActor: spawn(
						createWorkspaceSelectedResources({
							dependencies,
							lease: resourceLease,
							userId: required(context.source.userId)
						}),
						{
							input: { recipient: self }
						}
					)
				}
			}),
			shutDownResources: enqueueActions(({ context, enqueue }) => {
				if (context.resourceActor?.getSnapshot().status === 'active')
					enqueue.sendTo(context.resourceActor, { type: 'SHUTDOWN' })
			}),
			releaseResources: enqueueActions(({ context, event, enqueue }) => {
				if (!('output' in event)) throw new Error('Missing resource completion')
				enqueue.sendParent({ type: 'SELECTED_RESOURCES_RELEASED', result: event.output })
				enqueue.stopChild(required(context.resourceActor))
				enqueue.assign({
					resourceActor: undefined,
					resourceResult: event.output,
					resourceRelease: retainResourceRelease(context.resourceRelease, event.output.release),
					bankAccess: undefined,
					integrityReport: undefined
				})
				enqueue.raise({ type: 'RESOURCES_STOPPED' })
			}),
			failResources: enqueueActions(({ context, enqueue }) => {
				enqueue.sendParent({
					type: 'SELECTED_RESOURCES_CRASHED',
					lease: required(context.resourceLease)
				})
				enqueue.stopChild(required(context.resourceActor))
				enqueue.assign({
					resourceActor: undefined,
					resourceResult: {
						lease: required(context.resourceLease),
						drain: undefined,
						release: { outcome: 'unresolved' }
					},
					resourceRelease: { outcome: 'unresolved' },
					bankAccess: undefined,
					integrityReport: undefined
				})
				enqueue.raise({ type: 'RESOURCES_STOPPED' })
			}),
			publishBank: enqueueActions(({ context, check, enqueue }) => {
				const access: BankAccess = check('bankAccessAllowed')
					? {
							kind: 'allowed',
							organizationId: required(context.source.organizationId ?? undefined),
							userId: required(context.source.userId)
						}
					: {
							kind:
								check('canUseWorkspace') || check('navigationDenied') ? 'restricted' : 'waiting',
							organizationId: context.source.organizationId,
							userId: context.source.userId
						}
				const previous = context.bankAccess
				const authority = context.integrityRequest.binding
				if (
					previous &&
					previous.access.kind === access.kind &&
					previous.access.organizationId === access.organizationId &&
					previous.access.userId === access.userId &&
					sameIntegrityBinding(previous.authority, authority)
				)
					return
				const revision = context.bankRevision + 1
				enqueue.assign({ bankAccess: { revision, access, authority }, bankRevision: revision })
				if (context.resourceActor?.getSnapshot().status === 'active' && context.resourceLease)
					enqueue.sendTo(context.resourceActor, {
						type: 'BANK',
						lease: context.resourceLease,
						event: { type: 'WORKSPACE_ACCESS_CHANGED', revision, access }
					})
			})
		},
		guards: {
			bankAccessAllowed: and([
				'canUseWorkspace',
				'resourceBound',
				({ context }) =>
					canManageBankCredentials(context.source.membership, context.source.organizationId ?? '')
			]),
			navigationAlive: ({ context }) => context.navigationActor?.getSnapshot().status === 'active',
			navigationReady: ({ context }) =>
				context.sessionStatus === 'ready' && Boolean(context.source.userId),
			navigationCanUseWorkspace: stateIn({
				active: { session: 'ready', organization: 'ready', selection: 'selected' }
			}),
			awaitingInitialWorkspace: and([
				stateIn({ active: { workspace: 'waiting' } }),
				({ context }) =>
					context.organizations?.length === 0 &&
					context.organizationsError == null &&
					!workspaceRoute(context.route.search).scoped &&
					!['/settings/workspace', '/account', '/login'].includes(context.route.pathname)
			]),
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
			resourceBound: and([
				stateIn({ active: { resources: 'bound' } }),
				({ context }) =>
					context.resourceActor?.getSnapshot().status === 'active' &&
					context.selectionLease !== undefined &&
					context.resourceLease !== undefined &&
					sameWorkspaceLease(context.selectionLease, context.resourceLease)
			]),
			nativeAssessmentSettled: not(
				or([
					stateIn({ active: { session: 'checking' } }),
					stateIn({ active: { selection: 'checking' } }),
					stateIn({ active: { selection: 'checkingQuery' } }),
					stateIn({ active: { selection: 'choosingOrganization' } }),
					stateIn({ active: { organization: 'checking' } }),
					stateIn({ active: { organization: 'checkingMembership' } })
				])
			),
			resourceMatches: and([
				'canUseWorkspace',
				({ context }) =>
					context.resourceLease !== undefined &&
					context.selectionLease !== undefined &&
					sameWorkspaceLease(context.resourceLease, context.selectionLease) &&
					context.resourceLease.request.workspaceId === context.source.organizationId &&
					context.resourceUserId === context.source.userId
			]),
			resourceEligible: and([
				'canUseWorkspace',
				({ context }) => context.selectionLease !== undefined
			]),
			startupAlive: ({ context }) => context.startupActor?.getSnapshot().status === 'active',
			creationAlive: ({ context }) => context.creationActor?.getSnapshot().status === 'active',
			canObserveCreation: and([
				stateIn({ active: { session: 'ready', workspace: 'ready' } }),
				({ context }) =>
					context.initialization !== undefined &&
					context.initialization.userId === context.source.userId
			]),
			canObserveIntegrity: and([
				'canUseWorkspace',
				'resourceBound',
				({ context }) =>
					context.initialization !== undefined &&
					context.initialization.userId === context.source.userId
			])
		}
	}).createMachine({
		id: 'workspace-readiness',
		output: ({ context }) => ({ selectedResources: context.resourceRelease }),
		initial: 'active',
		context: () => {
			const observation = read()
			return {
				...observation,
				bankAccess: undefined,
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
				resourceActor: undefined,
				resourceLease: undefined,
				resourceUserId: undefined,
				selectionLease: undefined,
				selectionStatus: 'waiting',
				resourceResult: undefined,
				resourceRelease: { outcome: 'released' },
				bankRevision: -1,
				startupActor: undefined,
				creationActor: undefined,
				navigationActor: undefined
			}
		},
		invoke: [
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
			'xstate.done.actor.*': {
				guard: ({ context, event }) =>
					context.resourceActor?.id === event.actorId &&
					context.resourceLease !== undefined &&
					sameWorkspaceLease(event.output.lease, context.resourceLease),
				actions: 'releaseResources'
			},
			'xstate.error.actor.*': [
				{
					guard: ({ context, event }) => context.resourceActor?.id === event.actorId,
					actions: 'failResources'
				},
				{}
			],
			SELECTED_RESOURCE_DRAIN_REJECTED: {},
			BANK_NETWORK: {
				guard: and([
					'resourceBound',
					({ context, event }) =>
						context.resourceLease !== undefined &&
						sameWorkspaceLease(event.lease, context.resourceLease)
				]),
				actions: sendTo(
					({ context }) => required(context.resourceActor),
					({ event }): SelectedResourceCommand => ({
						type: 'BANK',
						lease: event.lease,
						event: { type: 'NETWORK_CHANGED', offline: event.offline }
					})
				)
			},
			OBSERVE_BANK: { guard: 'resourceBound', actions: 'publishBank' },
			BANK_OBSERVED: {
				guard: and([
					'resourceBound',
					({ context, event }) =>
						context.bankAccess !== undefined &&
						event.event.revision === context.bankAccess.revision &&
						event.organizationId === context.bankAccess.access.organizationId &&
						event.userId === context.bankAccess.access.userId
				]),
				actions: sendTo(
					({ context }) => required(context.resourceActor),
					({ context, event }) => ({
						type: 'BANK',
						lease: required(context.resourceLease),
						event: event.event
					})
				)
			},
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
					guard: or([not('navigationReady'), 'awaitingInitialWorkspace']),
					actions: raise({ type: 'NAVIGATION_REQUESTED', ready: false, access: 'waiting' })
				},
				{
					guard: 'invalidSelection',
					actions: raise({ type: 'NAVIGATION_REQUESTED', ready: true, access: 'denied' })
				},
				{
					guard: 'navigationCanUseWorkspace',
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
							loading:
								!workspaceRoute(context.route.search).scoped &&
								(context.organizationsLoading || context.organizations === undefined),
							error: workspaceRoute(context.route.search).scoped
								? undefined
								: context.organizationsError,
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
			INTEGRITY_REQUESTED: [
				{
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
						enqueueActions(({ context, check, enqueue }) => {
							if (check('resourceBound') && context.resourceActor && context.resourceLease)
								enqueue.sendTo(context.resourceActor, {
									type: 'INTEGRITY',
									lease: context.resourceLease,
									request: context.integrityRequest
								})
						}),
						raise({ type: 'OBSERVE_BANK' })
					]
				},
				{ actions: raise({ type: 'OBSERVE_BANK' }) }
			],
			BANK: [
				{
					guard: and([
						'resourceBound',
						({ context, event }) =>
							event.lease !== undefined &&
							context.resourceLease !== undefined &&
							sameWorkspaceLease(event.lease, context.resourceLease) &&
							(event.event.type === 'CANCEL' || event.event.type === 'RESET')
					]),
					actions: sendTo(
						({ context }) => required(context.resourceActor),
						({ context, event }) => ({
							type: 'BANK',
							lease: required(context.resourceLease),
							event: event.event
						})
					)
				},
				{
					guard: and([
						'bankAccessAllowed',
						({ context, event }) =>
							event.lease !== undefined &&
							context.resourceLease !== undefined &&
							sameWorkspaceLease(event.lease, context.resourceLease) &&
							event.event.type === 'SYNC'
					]),
					actions: sendTo(
						({ context }) => required(context.resourceActor),
						({ context, event }) => ({
							type: 'BANK',
							lease: required(context.resourceLease),
							event: event.event
						})
					)
				},
				{
					guard: and([
						'canUseWorkspace',
						'resourceBound',
						({ context, event }) =>
							event.lease !== undefined &&
							context.resourceLease !== undefined &&
							sameWorkspaceLease(event.lease, context.resourceLease) &&
							event.event.type !== 'SYNC'
					]),
					actions: sendTo(
						({ context }) => required(context.resourceActor),
						({ context, event }) => ({
							type: 'BANK',
							lease: required(context.resourceLease),
							event: event.event
						})
					)
				}
			],
			OBSERVED: {
				actions: [
					assign(({ event }) => event.observation),
					raise({ type: 'OBSERVE_STARTUP' }),
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
					SELECTION: {
						actions: [
							assign({
								selectionLease: ({ event }) => event.lease,
								selectionStatus: ({ event }) => event.status
							}),
							raise({ type: 'REEVALUATE' }),
							raise({ type: 'OBSERVE_NAVIGATION' }),
							raise({ type: 'OBSERVE_BANK' })
						]
					},
					NAVIGATION_STATUS: {
						guard: ({ context, event }) =>
							context.navigationFacts.generation === event.report.generation,
						actions: assign({ navigationReport: ({ event }) => event.report })
					},
					SELECTED_INTEGRITY_STATUS: {
						guard: ({ context, event }) =>
							context.resourceLease !== undefined &&
							sameWorkspaceLease(event.lease, context.resourceLease) &&
							sameIntegrityRequest(context.integrityRequest, event.report.request),
						actions: assign({ integrityReport: ({ event }) => event.report })
					},
					NAVIGATION_STOPPED: '#workspace-readiness.closing.intent.failed',
					STARTUP_STOPPED: '#workspace-readiness.closing.intent.failed',
					CREATION_STOPPED: '#workspace-readiness.closing.intent.failed'
				},
				states: {
					resources: {
						initial: 'unbound',
						states: {
							unbound: {
								always: { guard: 'resourceEligible', target: 'bound', actions: 'startResources' }
							},
							bound: {
								entry: raise({ type: 'OBSERVE_INTEGRITY', restart: true }),
								always: {
									guard: and(['nativeAssessmentSettled', not('resourceMatches')]),
									target: 'draining'
								},
								on: {
									SELECTED_RESOURCES_STOPPING: {
										guard: ({ context, event }) =>
											context.resourceLease !== undefined &&
											sameWorkspaceLease(event.lease, context.resourceLease),
										target: 'failing'
									},
									RESOURCES_STOPPED: 'unresolved'
								}
							},
							draining: {
								entry: [
									assign({ bankAccess: undefined, integrityReport: undefined }),
									'shutDownResources'
								],
								on: {
									RESOURCES_STOPPED: [
										{
											guard: ({ context }) =>
												context.resourceResult?.release.outcome === 'unresolved',
											target: 'unresolved'
										},
										{ target: 'unbound' }
									]
								}
							},
							failing: {
								entry: [
									assign({ bankAccess: undefined, integrityReport: undefined }),
									'shutDownResources'
								],
								on: {
									RESOURCES_STOPPED: [
										{
											guard: ({ context }) =>
												context.resourceResult?.release.outcome === 'unresolved',
											target: 'unresolved'
										},
										{ target: 'failed' }
									]
								}
							},
							failed: { tags: 'workspace-error' },
							unresolved: { tags: 'workspace-error' }
						}
					},
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
									{ guard: 'navigationReady', target: 'ready' },
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
									{ guard: 'navigationReady', target: 'checkingQuery' },
									{ target: 'waiting' }
								]
							},
							checkingQuery: { always: 'choosingOrganization' },
							choosingOrganization: {
								always: [
									{
										guard: ({ context }) =>
											context.selectionStatus === 'selected' &&
											context.selectionLease?.request.workspaceId === context.source.organizationId,
										target: 'selected'
									},
									{
										guard: ({ context }) =>
											context.selectionStatus === 'failed' ||
											context.selectionStatus === 'drainFailed',
										target: 'failed'
									},
									{
										guard: ({ context }) =>
											context.selectionStatus === 'denied' ||
											context.selectionStatus === 'unavailable',
										target: 'unavailableSelection'
									},
									{
										guard: ({ context }) => context.source.organizationId == null,
										target: 'unselected'
									},
									{ target: 'waiting' }
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
							unavailable: {},
							unselected: {},
							loadingMembership: {},
							denied: {},
							failed: {},
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
					startupActor: ({ self }) => self.getSnapshot().children.startup,
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
					resources: {
						initial: 'checking',
						states: {
							checking: {
								always: [
									{
										guard: ({ context }) => context.resourceActor !== undefined,
										target: 'stopping'
									},
									{ target: 'stopped' }
								]
							},
							stopping: { entry: 'shutDownResources', on: { RESOURCES_STOPPED: 'stopped' } },
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
		bankRevision: snapshot?.context.bankAccess?.revision,
		ready: snapshot?.matches({ active: { session: 'ready' } }) === true,
		failed: snapshot?.hasTag('workspace-error') ?? false,
		canRetry: snapshot?.hasTag('workspace-retryable') ?? false,
		canSync:
			snapshot?.can({
				type: 'BANK',
				lease: snapshot.context.resourceLease,
				event: { type: 'SYNC' }
			}) ?? false,
		resourceLease: snapshot?.matches({ active: { resources: 'bound' } })
			? snapshot.context.resourceLease
			: undefined,
		navigation: snapshot?.context.navigationReport?.status ?? 'waiting',
		creation: snapshot?.context.creationView ?? unavailableWorkspaceCreationView,
		integrity: selectWorkspaceIntegrityView(snapshot?.context.integrityReport)
	}
}
/** Public actor reference for integration subscriptions; bank workflow internals stay encapsulated. */
export function workspaceBankActor(snapshot: WorkspaceCoordinatorSnapshot) {
	return snapshot.matches({ active: { resources: 'bound' } })
		? selectedResourceBankActor(snapshot.context.resourceActor?.getSnapshot())
		: undefined
}
