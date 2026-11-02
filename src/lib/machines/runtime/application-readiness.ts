import {
	assign,
	fromCallback,
	fromPromise,
	enqueueActions,
	and,
	or,
	stateIn,
	raise,
	sendTo,
	setup
} from 'xstate'
import type { ActorRefFrom, SnapshotFrom, DoneActorEvent } from 'xstate'
import type { JazzClient, JazzSession } from 'jazz-tools/svelte'
import type { MutationErrorEvent } from 'jazz-tools'
import type { TransferWriteTracking } from '../transfers/internal-transfer.js'
import {
	createInternalTransferMutationOwner,
	rejectedTransferMutation,
	type TransferMutationRequest
} from '../transfers/internal-transfer-mutation-owner.js'
import {
	createSessionStartupMachine,
	createSessionReadinessMachine
} from 'delightful-local-first/session/workflow'
import type {
	SessionReadinessBinding,
	SessionReadinessScope,
	SessionReadinessReport,
	SessionObservationFailure,
	SessionStatus,
	SessionStartupReport
} from 'delightful-local-first/session/contracts'
import type { JazzStartupBinding } from '#lib/runtime/jazz-session.js'
import {
	createWorkspaceReadinessMachine,
	type WorkspaceAttachment,
	type ReadinessObservation
} from './readiness.js'
import type {
	WorkspaceLease,
	WorkspaceDrainRequest,
	WorkspaceSelectionRequest
} from 'delightful-local-first/workspace/contracts'
import {
	createWorkspaceSelectionAttachmentMachine,
	type WorkspaceSelectionBinding,
	type WorkspaceSelectionAttachmentReport
} from './workspace-selection-attachment.js'
import {
	createWorkspaceSelectionDrainMachine,
	transferScopeForWorkspaceLease,
	type WorkspaceSelectionDrainOutput
} from './workspace-selection-drain.js'
import {
	sameWorkspaceLease,
	type SelectedResourceOutput
} from '../../contracts/workspace-selected-resources.js'
import {
	retainResourceRelease,
	type WorkspaceResourceRelease
} from '../../contracts/workspace-resource-release.js'
import {
	workspaceSelectionTarget,
	workspaceSelectionObservation
} from './workspace-selection-observation.js'
import type { TransferMutationScope } from '../../contracts/transfer-scope-drain.js'
import type { TransferMutationRequestInput } from '../transfers/internal-transfer-mutation-request.js'
import { required } from '../bank-sync/identity.js'
import {
	sessionRecoveryMachine,
	type RecoveryNotice,
	type RecoveryRequest,
	type RecoveryResult,
	type RecoveryRestorationBinding
} from '../identity/session-recovery.js'

type Session = JazzSession<JazzClient>
type Workspace = ActorRefFrom<ReturnType<typeof createWorkspaceReadinessMachine>>
type Status = SessionStatus
export type MutationNotice =
	| { kind: 'generic'; transactionId: string }
	| {
			kind: 'transfer'
			operation: TransferWriteTracking['operation']
			transactionId: string
			transferId: string
	  }
type Context = {
	selectionBinding: WorkspaceSelectionBinding | undefined
	selectionRevision: number
	selectionLease: WorkspaceLease | undefined
	transferScope: TransferMutationScope | undefined
	transferLease: WorkspaceLease | undefined
	transferGeneration: number
	selectionRequest: WorkspaceSelectionRequest | undefined
	selectionAttempt: number
	selectionGeneration: number
	selectionStatus:
		'waiting' | 'selected' | 'denied' | 'unavailable' | 'failed' | 'suspended' | 'drainFailed'
	selectionFacts: ReadinessObservation | undefined
	selectionDrain: WorkspaceDrainRequest | undefined
	handledDrains: WeakSet<object>
	drainActor: ActorRefFrom<ReturnType<typeof createWorkspaceSelectionDrainMachine>> | undefined
	resourceResult: SelectedResourceOutput | undefined
	cleanupRelease: WorkspaceResourceRelease
	attachmentRevision: number
	recoveryDraftRevision: number
	recoveryAttempt: number
	recoveryRequest: RecoveryRequest | undefined
	recoveryResult: RecoveryResult | undefined
	session: Session | undefined
	startupBinding: JazzStartupBinding | undefined
	readinessScope: SessionReadinessScope | undefined
	observation: number
	retryAttempt: number
	observationFailure: SessionObservationFailure | undefined
	status: Status
	workspace: Workspace | undefined
	attachment: WorkspaceAttachment | undefined
	pending: WorkspaceAttachment | undefined
	trackedTransferWrites: TransferWriteTracking[]
	mutationNotice: MutationNotice | undefined
	transferMutationOwnerClosed: boolean
}
type Event =
	| WorkspaceSelectionAttachmentReport
	| DoneActorEvent<WorkspaceSelectionDrainOutput | { selectedResources: WorkspaceResourceRelease }>
	| {
			type: 'WORKSPACE_SELECTION_OBSERVED'
			attachment: WorkspaceAttachment
			observation: ReadinessObservation
	  }
	| { type: 'SELECTED_RESOURCES_RELEASED'; result: SelectedResourceOutput }
	| { type: 'SELECTED_RESOURCES_CRASHED'; lease: WorkspaceLease }
	| { type: 'CLEANUP_FAILED' }
	| { type: 'RESOURCE_OWNER_FAILED' }
	| RecoveryNotice
	| SessionStartupReport<Session>
	| SessionReadinessReport
	| { type: 'RECOVER'; phrase: string; origin: string; destination: string }
	| { type: 'RETRY_NAVIGATION' }
	| { type: 'START'; startup: JazzStartupBinding }
	| { type: 'STARTUP_RELEASED' }
	| { type: 'READINESS_RELEASED' }
	| { type: 'STARTUP_UNAVAILABLE' }
	| { type: 'RETRY' }
	| { type: 'ACQUIRED_STATUS'; status: Status; afterRetry: number | undefined }
	| { type: 'OBSERVATION_UNAVAILABLE' }
	| { type: 'MUTATION_REJECTED'; transactionId: string }
	| { type: 'TRANSFER_WRITE_TRACKED'; write: TransferWriteTracking }
	| { type: 'TRANSFER_MUTATION_REQUEST'; request: TransferMutationRequest }
	| { type: 'CANCEL_TRANSFER_MUTATION'; requestId: string }
	| { type: 'WORKSPACE_SCOPE_OBSERVED'; workspaceId: string | undefined }
	| { type: 'TRANSFER_MUTATION_OWNER_CLOSED' }
	| { type: 'DISMISS_MUTATION_REJECTION' }
	| { type: 'ATTACH_WORKSPACE'; attachment: WorkspaceAttachment }
	| { type: 'DETACH_WORKSPACE'; attachment: WorkspaceAttachment }
	| { type: 'WORKSPACE_CLOSED'; actor: unknown }
	| { type: 'ATTACH_PENDING' }
	| { type: 'SHUTDOWN' }
	| { type: `xstate.error.actor.${string}`; actorId: string; error: unknown }

function workspaceReleased(context: Context) {
	return (
		!context.workspace &&
		!context.selectionBinding &&
		!context.drainActor &&
		context.cleanupRelease.outcome !== 'unresolved'
	)
}
function currentSelectionScope(context: Context, scope: WorkspaceLease['scope']) {
	return (
		context.selectionBinding?.scope.binding === scope.binding &&
		context.selectionBinding.scope.attachment === scope.attachment
	)
}

/** Layout-owned factories bind acquired session capabilities; Finance owns domain coordination. */
export function createApplicationReadinessMachine(
	navigation: { readHref: () => string; navigate: (destination: string) => Promise<void> } = {
		readHref: () => '',
		navigate: async () => {
			throw new Error('Navigation unavailable')
		}
	},
	bindRestoration?: (session: Session) => RecoveryRestorationBinding,
	bindReadiness?: (session: Session) => SessionReadinessBinding
) {
	const actors = {
		recovery: sessionRecoveryMachine,
		selectionAttachment: createWorkspaceSelectionAttachmentMachine(),
		transferMutationOwner: createInternalTransferMutationOwner(),
		startup: createSessionStartupMachine<Session>(),
		sessionReadiness: createSessionReadinessMachine(),
		bindSessionReadiness: fromPromise(({ input }: { input: Session }) =>
			Promise.resolve({ session: input, readiness: required(bindReadiness)(input) })
		),
		observeMutationRejections: fromCallback<Event, Session>(({ input, sendBack }) => {
			const db = input.getSnapshot().client?.db
			if (!db) return
			return db.onMutationError((rejection) => {
				sendBack({
					type: 'MUTATION_REJECTED',
					transactionId: rejection.transaction.transactionId
				})
			})
		})
	}
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{},
		{ refreshAttachment: undefined; retireStartup: undefined; shutDownReadiness: undefined },
		{
			startupOwnerFailed: undefined
			currentStartup: undefined
			currentReadiness: undefined
			currentObservation: undefined
			currentRetry: undefined
			readinessStopping: undefined
			shuttingDown: undefined
			retryObserverFailed: undefined
			retryStartupFailed: undefined
			recoveryClosing: undefined
			recoveryObserverFailed: undefined
			recoveryStartupFailed: undefined
			recoveryReadinessCrashed: undefined
			cleanupPending: undefined
			recoveryCleanupFailed: undefined
			retryCleanupFailed: undefined
		},
		never,
		string
	>({
		actors,
		actions: {
			shutDownReadiness: enqueueActions(({ self, enqueue }) => {
				const child = self.getSnapshot().children.sessionReadiness
				if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'SHUTDOWN' })
				else enqueue.raise({ type: 'READINESS_RELEASED' })
			}),
			retireStartup: enqueueActions(({ context, self, enqueue }) => {
				const child = self.getSnapshot().children.startup
				if (context.startupBinding && child) {
					enqueue.sendTo(context.startupBinding.owner, {
						type: 'RELEASE',
						scope: context.startupBinding.scope,
						replyTo: child
					})
				}
			}),
			refreshAttachment: assign({
				attachmentRevision: ({ context }) => context.attachmentRevision + 1,
				pending: undefined
			})
		},
		guards: {
			cleanupPending: ({ context }) => context.cleanupRelease.outcome === 'unresolved',
			currentReadiness: ({ context, event }) =>
				'scope' in event &&
				event.scope.binding === context.readinessScope?.binding &&
				event.scope.attachment === context.readinessScope.attachment,
			currentObservation: and([
				'currentReadiness',
				({ context, event }) =>
					(event.type === 'SESSION_STATUS' || event.type === 'SESSION_OBSERVATION_FAILED') &&
					event.observation === context.observation
			]),
			currentRetry: and([
				'currentReadiness',
				({ context, event }) =>
					(event.type === 'SESSION_RETRY_SETTLED' || event.type === 'SESSION_RETRY_STARTED') &&
					event.attempt === context.retryAttempt
			]),
			readinessStopping: or([
				stateIn('closing'),
				stateIn('releasingReadiness'),
				stateIn('releasingStartup'),
				stateIn('settlingStartupFailure'),
				stateIn('startupActorFailed'),
				stateIn({ running: { retrying: 'closing' } }),
				stateIn({ running: { retrying: 'startupFailed' } }),
				stateIn({ running: { recovering: 'closing' } }),
				stateIn({ running: { recovering: 'startupFailed' } })
			]),
			currentStartup: ({ context, event }) =>
				(event.type === 'SESSION_STARTING' ||
					event.type === 'SESSION_ACQUIRED' ||
					event.type === 'SESSION_STARTUP_FAILED') &&
				event.scope.binding === context.startupBinding?.scope.binding &&
				event.scope.attachment === context.startupBinding.scope.attachment &&
				event.scope.generation === context.startupBinding.scope.generation,
			startupOwnerFailed: and([
				'currentStartup',
				({ event }) => event.type === 'SESSION_STARTUP_FAILED' && event.reason === 'ownerFailed'
			]),
			shuttingDown: or([
				stateIn('closing'),
				stateIn('releasingStartup'),
				stateIn('releasingReadiness'),
				stateIn({ running: { retrying: 'closing' } }),
				stateIn({ running: { recovering: 'closing' } })
			]),
			retryObserverFailed: stateIn({ running: { retrying: 'observerFailed' } }),
			retryStartupFailed: stateIn({ running: { retrying: 'startupFailed' } }),
			recoveryClosing: stateIn({ running: { recovering: 'closing' } }),
			recoveryObserverFailed: stateIn({ running: { recovering: 'observerFailed' } }),
			recoveryStartupFailed: stateIn({ running: { recovering: 'startupFailed' } }),
			recoveryReadinessCrashed: stateIn({ running: { recovering: 'readinessCrashed' } }),
			recoveryCleanupFailed: stateIn({ running: { recovering: 'cleanupFailed' } }),
			retryCleanupFailed: stateIn({ running: { retrying: 'cleanupFailed' } })
		}
	})
	const attach = workflow.enqueueActions(({ context, enqueue }) => {
		if (context.selectionRevision >= Number.MAX_SAFE_INTEGER) {
			enqueue.raise({ type: 'CLEANUP_FAILED' })
			return
		}
		const attachment = required(context.pending)
		const binding: WorkspaceSelectionBinding = {
			scope: { binding: attachment.dependencies.db, attachment: {} },
			revision: context.selectionRevision + 1
		}
		enqueue.assign(({ spawn }) => ({
			attachment,
			workspace: spawn(createWorkspaceReadinessMachine(attachment)),
			pending: undefined,
			selectionBinding: binding,
			selectionRevision: binding.revision,
			selectionLease: undefined,
			transferScope: undefined,
			transferLease: undefined,
			selectionRequest: undefined,
			selectionAttempt: 0,
			selectionGeneration: 0,
			selectionStatus: 'waiting',
			selectionFacts: undefined,
			cleanupRelease: { outcome: 'released' },
			resourceResult: undefined
		}))
		enqueue.sendTo('selectionAttachment', { type: 'ATTACH', binding })
	})
	const detachSelection = workflow.enqueueActions(({ context, enqueue }) => {
		enqueue.assign({ selectionLease: undefined, selectionRequest: undefined })
		if (context.selectionBinding)
			enqueue.sendTo('selectionAttachment', { type: 'DETACH', binding: context.selectionBinding })
		if (context.workspace?.getSnapshot().matches('active')) {
			enqueue.sendTo(context.workspace, {
				type: 'SELECTION',
				lease: undefined,
				status: 'suspended'
			})
		}
	})
	const shutDownWorkspace = workflow.enqueueActions(({ context, enqueue }) => {
		enqueue.assign({ pending: undefined })
		enqueue(detachSelection)
		if (context.workspace?.getSnapshot().status === 'active')
			enqueue.sendTo(context.workspace, { type: 'SHUTDOWN' })
	})
	const release = workflow.enqueueActions(({ context, event, enqueue }) => {
		enqueue(detachSelection)
		if (event.type.startsWith('xstate.error.actor.')) {
			enqueue.assign({ cleanupRelease: { outcome: 'unresolved' } })
			if (context.drainActor?.getSnapshot().status === 'active' && context.selectionDrain)
				enqueue.sendTo(context.drainActor, {
					type: 'SELECTED_RESOURCES_CRASHED',
					lease: context.selectionDrain.lease
				})
			enqueue.raise({ type: 'CLEANUP_FAILED' })
		}
		enqueue.stopChild(required(context.workspace))
		enqueue.assign({ workspace: undefined, attachment: undefined })
		enqueue.raise({ type: 'ATTACH_PENDING' })
	})
	// These states retain the parent's issued retry while its observer and workspace drain.
	const retryDrain = workflow.createStateConfig({
		entry: shutDownWorkspace,
		on: {
			ACQUIRED_STATUS: {},
			OBSERVATION_UNAVAILABLE: {},
			ATTACH_WORKSPACE: {},
			ATTACH_PENDING: {},
			RECOVER: {},
			RETRY_NAVIGATION: {},
			RETRY: {},
			START: {}
		}
	})

	const retainAttachment = workflow.assign({
		pending: ({ context, event }) =>
			event.type === 'ATTACH_WORKSPACE' ? event.attachment : context.pending
	})
	const shutDownRecovery = workflow.enqueueActions(({ self, enqueue }) => {
		const child = self.getSnapshot().children.recovery
		if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'SHUTDOWN' })
	})
	const recoveryDrain = workflow.createStateConfig({
		entry: [shutDownWorkspace, shutDownRecovery],
		on: {
			ACQUIRED_STATUS: {},
			OBSERVATION_UNAVAILABLE: {},
			ATTACH_WORKSPACE: {},
			ATTACH_PENDING: {},
			RECOVERY_DRAIN_REQUESTED: {},
			RECOVERY_VALIDATED: {},
			START: {},
			RETRY: {},
			RECOVER: {},
			RETRY_NAVIGATION: {}
		}
	})
	return workflow.createMachine({
		id: 'application-readiness',
		initial: 'waitingForStartup',
		context: () => ({
			selectionBinding: undefined,
			selectionRevision: -1,
			selectionLease: undefined,
			transferScope: undefined,
			transferLease: undefined,
			transferGeneration: 0,
			selectionRequest: undefined,
			selectionAttempt: 0,
			selectionGeneration: 0,
			selectionStatus: 'waiting',
			selectionFacts: undefined,
			selectionDrain: undefined,
			handledDrains: new WeakSet(),
			drainActor: undefined,
			resourceResult: undefined,
			cleanupRelease: { outcome: 'released' },
			attachmentRevision: 0,
			recoveryDraftRevision: 0,
			recoveryAttempt: 0,
			recoveryRequest: undefined,
			recoveryResult: undefined,
			session: undefined,
			startupBinding: undefined,
			readinessScope: undefined,
			observation: 0,
			retryAttempt: 0,
			observationFailure: undefined,
			status: 'transitioning',
			workspace: undefined,
			attachment: undefined,
			pending: undefined,
			trackedTransferWrites: [],
			mutationNotice: undefined,
			transferMutationOwnerClosed: false
		}),
		invoke: [
			{
				id: 'startup',
				src: 'startup',
				input: ({ self }) => ({ reportTo: self }),
				onDone: [
					{ guard: 'cleanupPending', actions: raise({ type: 'STARTUP_RELEASED' }) },
					{ guard: 'shuttingDown', actions: raise({ type: 'STARTUP_RELEASED' }) },
					{ target: '.settlingStartupFailure' }
				],
				onError: [
					{
						guard: 'cleanupPending',
						actions: ['retireStartup', raise({ type: 'STARTUP_RELEASED' })]
					},
					{
						guard: 'shuttingDown',
						actions: ['retireStartup', raise({ type: 'STARTUP_RELEASED' })]
					},
					{ target: '.settlingStartupFailure', actions: 'retireStartup' }
				]
			},
			{
				id: 'sessionReadiness',
				src: 'sessionReadiness',
				input: ({ self }) => ({ reportTo: self }),
				onDone: [
					{ guard: 'cleanupPending', actions: raise({ type: 'READINESS_RELEASED' }) },
					{ guard: 'readinessStopping', actions: raise({ type: 'READINESS_RELEASED' }) },
					{ target: '.settlingReadinessCrash' }
				],
				onError: [
					{ guard: 'cleanupPending', actions: raise({ type: 'READINESS_RELEASED' }) },
					{ guard: 'shuttingDown', actions: raise({ type: 'READINESS_RELEASED' }) },
					{ target: '.settlingReadinessCrash' }
				]
			},
			{
				id: 'selectionAttachment',
				src: 'selectionAttachment',
				input: ({ self }) => ({ reportTo: self }),
				onError: { actions: raise({ type: 'CLEANUP_FAILED' }) }
			},
			{
				id: 'transferMutationOwner',
				src: 'transferMutationOwner',
				onDone: [
					{
						guard: and(['shuttingDown', ({ event }) => event.output.outcome === 'closed']),
						actions: assign({ transferMutationOwnerClosed: true })
					},
					{ actions: raise({ type: 'CLEANUP_FAILED' }) }
				],
				onError: {
					actions: workflow.enqueueActions(({ context, enqueue }) => {
						if (context.drainActor?.getSnapshot().status === 'active' && context.selectionDrain)
							enqueue.sendTo(context.drainActor, {
								type: 'TRANSFER_OWNER_CRASHED',
								drain: context.selectionDrain
							})
						enqueue.raise({ type: 'CLEANUP_FAILED' })
					})
				}
			}
		],
		on: {
			'xstate.error.actor.*': [
				{
					guard: ({ context, event }) => context.drainActor?.id === event.actorId,
					actions: workflow.enqueueActions(({ context, enqueue }) => {
						if (context.selectionBinding && context.selectionDrain)
							enqueue.sendTo('selectionAttachment', {
								type: 'SELECTION_COMMAND',
								binding: context.selectionBinding,
								command: {
									type: 'DRAIN_FAILED',
									drain: context.selectionDrain,
									outcome: 'unresolved'
								}
							})
						enqueue.raise({ type: 'CLEANUP_FAILED' })
					})
				},
				{
					guard: ({ context, event }) => context.workspace?.id === event.actorId,
					target: '.settlingObserverFailure',
					actions: [assign({ pending: undefined }), release]
				},
				{}
			],
			START: {},
			RETRY: {},
			STARTUP_RELEASED: {},
			READINESS_RELEASED: {},
			SESSION_STATUS: {
				guard: 'currentObservation',
				actions: raise(({ event }) => ({
					type: 'ACQUIRED_STATUS',
					status: event.status,
					afterRetry: event.afterRetry
				}))
			},
			SESSION_OBSERVATION_FAILED: {
				guard: 'currentObservation',
				actions: [
					assign({ observationFailure: ({ event }) => event.reason }),
					raise({ type: 'OBSERVATION_UNAVAILABLE' })
				]
			},
			SESSION_OBSERVATION_CLEANUP_FAILED: {},
			SESSION_RETRY_STARTED: {},
			SESSION_RETRY_SETTLED: {},
			ACQUIRED_STATUS: { actions: assign({ status: ({ event }) => event.status }) },
			OBSERVATION_UNAVAILABLE: {},
			SESSION_STARTING: {},
			SESSION_ACQUIRED: {},
			SESSION_STARTUP_FAILED: {
				guard: 'currentStartup',
				actions: raise({ type: 'STARTUP_UNAVAILABLE' })
			},
			STARTUP_UNAVAILABLE: { target: '.settlingStartupFailure' },
			TRANSFER_MUTATION_REQUEST: [
				{
					guard: and([
						stateIn({ running: 'ready' }),
						({ context, event }) => {
							const scope = contextTransferScope(context, event.request)
							return (
								scope !== undefined &&
								event.request.scope !== undefined &&
								scope.binding === event.request.scope.binding &&
								scope.workspaceId === event.request.scope.workspaceId &&
								scope.generation === event.request.scope.generation
							)
						}
					]),
					actions: sendTo('transferMutationOwner', ({ event }) => ({
						type: 'REQUEST_TRANSFER_MUTATION',
						request: event.request
					}))
				},
				{
					actions: ({ event }) =>
						event.request.recipient.send({
							type: 'TRANSFER_MUTATION_RESULT',
							requestId: event.request.requestId,
							result: rejectedTransferMutation(event.request)
						})
				}
			],
			CANCEL_TRANSFER_MUTATION: { actions: sendTo('transferMutationOwner', ({ event }) => event) },
			WORKSPACE_SCOPE_OBSERVED: {},
			TRANSFER_MUTATION_OWNER_CLOSED: {
				actions: assign({ transferMutationOwnerClosed: true })
			},
			SHUTDOWN: {
				target: '.closing',
				actions: assign({ pending: undefined })
			},
			ATTACH_WORKSPACE: [
				{
					guard: ({ context, event }) =>
						context.attachment === event.attachment || context.pending === event.attachment
				},
				{
					guard: ({ context }) =>
						Boolean(context.workspace || context.selectionBinding || context.drainActor),
					actions: [
						assign({ pending: ({ event }) => event.attachment }),
						detachSelection,
						workflow.enqueueActions(({ context, enqueue }) => {
							if (context.workspace?.getSnapshot().status === 'active')
								enqueue.sendTo(context.workspace, { type: 'SHUTDOWN' })
						})
					]
				},
				{
					guard: ({ context }) => context.cleanupRelease.outcome !== 'unresolved',
					actions: [assign({ pending: ({ event }) => event.attachment }), attach]
				}
			],
			DETACH_WORKSPACE: [
				{
					guard: ({ context, event }) => context.pending === event.attachment,
					actions: assign({ pending: undefined })
				},
				{
					guard: ({ context, event }) => context.attachment === event.attachment,
					actions: [
						detachSelection,
						workflow.enqueueActions(({ context, enqueue }) => {
							if (context.workspace?.getSnapshot().status === 'active')
								enqueue.sendTo(context.workspace, { type: 'SHUTDOWN' })
						})
					]
				}
			],
			WORKSPACE_CLOSED: {},
			ATTACH_PENDING: {
				guard: ({ context }) => Boolean(context.pending) && workspaceReleased(context),
				actions: attach
			},
			RESOURCE_OWNER_FAILED: { target: '.settlingResourceFailure' },
			CLEANUP_FAILED: {
				target: '.cleanupFailed',
				actions: assign({ cleanupRelease: { outcome: 'unresolved' } })
			},
			WORKSPACE_SELECTION_ATTACHED: {
				guard: ({ context, event }) =>
					event.binding.revision === context.selectionBinding?.revision &&
					currentSelectionScope(context, event.binding.scope),
				actions: workflow.enqueueActions(({ context, enqueue }) => {
					if (context.attachment)
						enqueue.raise({
							type: 'WORKSPACE_SELECTION_OBSERVED',
							attachment: context.attachment,
							observation: context.attachment.read()
						})
				})
			},
			WORKSPACE_SELECTION_RELEASED: {
				guard: ({ context, event }) =>
					event.binding.revision === context.selectionBinding?.revision &&
					currentSelectionScope(context, event.binding.scope),
				actions: [
					assign({ selectionBinding: undefined, selectionLease: undefined }),
					raise({ type: 'ATTACH_PENDING' })
				]
			},
			WORKSPACE_SELECTION_ATTACHMENT_FAILED: {
				guard: ({ context, event }) =>
					event.binding.revision === context.selectionBinding?.revision &&
					currentSelectionScope(context, event.binding.scope),
				actions: raise({ type: 'CLEANUP_FAILED' })
			},
			WORKSPACE_SELECTION_OBSERVED: {
				guard: ({ context, event }) =>
					context.attachment === event.attachment &&
					context.workspace?.getSnapshot().matches('active') === true &&
					context.selectionBinding !== undefined &&
					context.cleanupRelease.outcome !== 'unresolved',
				actions: workflow.enqueueActions(({ context, event, self, enqueue }) => {
					if (
						!self
							.getSnapshot()
							.children.selectionAttachment?.getSnapshot()
							.matches({ holding: 'active' })
					)
						return
					if (event.type !== 'WORKSPACE_SELECTION_OBSERVED')
						throw new Error('Unexpected selection event')
					if (
						context.selectionFacts &&
						context.selectionFacts.source.userId !== event.observation.source.userId
					) {
						enqueue.assign({ pending: event.attachment })
						enqueue(detachSelection)
						enqueue.sendTo(required(context.workspace), { type: 'SHUTDOWN' })
						return
					}
					const binding = required(context.selectionBinding)
					const target = workspaceSelectionTarget(event.observation)
					enqueue.assign({ selectionFacts: event.observation })
					enqueue.sendTo(required(context.workspace), {
						type: 'OBSERVED',
						observation: event.observation
					})
					if (
						context.selectionGeneration >= Number.MAX_SAFE_INTEGER ||
						context.selectionAttempt >= Number.MAX_SAFE_INTEGER
					) {
						enqueue.raise({ type: 'CLEANUP_FAILED' })
						return
					}
					if (!target) {
						enqueue.assign({ selectionLease: undefined, selectionRequest: undefined })
						enqueue.sendTo('selectionAttachment', {
							type: 'SELECTION_COMMAND',
							binding,
							command: { type: 'SUSPEND', scope: binding.scope }
						})
						return
					}
					const changed = target !== context.selectionRequest?.workspaceId
					const request = changed
						? { workspaceId: target, attempt: context.selectionAttempt + 1 }
						: required(context.selectionRequest)
					const generation = context.selectionGeneration + 1
					enqueue.assign({
						selectionRequest: request,
						selectionAttempt: request.attempt,
						selectionGeneration: generation
					})
					if (changed) {
						enqueue.assign({ selectionLease: undefined })
						enqueue.sendTo('selectionAttachment', {
							type: 'SELECTION_COMMAND',
							binding,
							command: { type: 'SELECT', scope: binding.scope, request }
						})
					}
					enqueue.sendTo('selectionAttachment', {
						type: 'SELECTION_COMMAND',
						binding,
						command: {
							type: context.selectionStatus === 'suspended' ? 'RESUME' : 'OBSERVED',
							observation: workspaceSelectionObservation(
								event.observation,
								binding.scope,
								request,
								generation
							)
						}
					})
				})
			},
			WORKSPACE_SELECTION: {
				guard: ({ context, event }) =>
					currentSelectionScope(
						context,
						event.status === 'selected' ? event.lease.scope : event.scope
					) &&
					(event.status === 'selected' ||
						(event.status === 'suspended' && !context.selectionLease) ||
						(event.request?.workspaceId === context.selectionRequest?.workspaceId &&
							event.request?.attempt === context.selectionRequest?.attempt)) &&
					(event.status !== 'selected' ||
						(event.lease.request.workspaceId === context.selectionRequest?.workspaceId &&
							event.lease.request.attempt === context.selectionRequest.attempt &&
							context.selectionFacts !== undefined &&
							workspaceSelectionTarget(context.selectionFacts) ===
								event.lease.request.workspaceId &&
							workspaceSelectionObservation(
								context.selectionFacts,
								event.lease.scope,
								event.lease.request,
								0
							).access === 'allowed')),
				actions: workflow.enqueueActions(({ context, event, self, enqueue }) => {
					if (
						!self
							.getSnapshot()
							.children.selectionAttachment?.getSnapshot()
							.matches({ holding: 'active' })
					)
						return
					if (event.type !== 'WORKSPACE_SELECTION') throw new Error('Unexpected selection event')
					if (event.status === 'selected') {
						if (
							!context.workspace?.getSnapshot().matches('active') ||
							context.pending ||
							context.cleanupRelease.outcome === 'unresolved'
						)
							return
						if (
							!context.selectionLease ||
							!sameWorkspaceLease(context.selectionLease, event.lease)
						) {
							if (context.transferGeneration >= Number.MAX_SAFE_INTEGER) {
								enqueue.raise({ type: 'CLEANUP_FAILED' })
								return
							}
							const scope = {
								...transferScopeForWorkspaceLease(event.lease),
								generation: context.transferGeneration + 1
							}
							enqueue.assign({
								transferScope: scope,
								transferLease: event.lease,
								transferGeneration: scope.generation
							})
							enqueue.sendTo('transferMutationOwner', { type: 'BIND_TRANSFER_SCOPE', scope })
							enqueue.assign({ resourceResult: undefined })
						}
						enqueue.assign({ selectionLease: event.lease, selectionStatus: event.status })
						enqueue.sendTo(context.workspace, {
							type: 'SELECTION',
							status: event.status,
							lease: event.lease
						})
						return
					}
					enqueue.assign({ selectionLease: undefined, selectionStatus: event.status })
					if (context.workspace?.getSnapshot().status === 'active')
						enqueue.sendTo(context.workspace, {
							type: 'SELECTION',
							status: event.status,
							lease: undefined
						})
					if (
						event.status === 'suspended' &&
						context.attachment &&
						context.workspace?.getSnapshot().matches('active')
					)
						enqueue.raise({
							type: 'WORKSPACE_SELECTION_OBSERVED',
							attachment: context.attachment,
							observation: context.attachment.read()
						})
				})
			},
			WORKSPACE_SCOPE_INVALIDATED: {
				guard: ({ context, event }) =>
					currentSelectionScope(context, event.lease.scope) &&
					context.transferLease !== undefined &&
					sameWorkspaceLease(context.transferLease, event.lease),
				actions: [
					assign({ selectionLease: undefined }),
					workflow.enqueueActions(({ context, enqueue }) => {
						if (context.workspace?.getSnapshot().status === 'active')
							enqueue.sendTo(context.workspace, {
								type: 'SELECTION',
								lease: undefined,
								status: 'waiting'
							})
					})
				]
			},
			WORKSPACE_DRAIN_REQUESTED: {
				guard: ({ context, event }) =>
					currentSelectionScope(context, event.drain.lease.scope) &&
					!context.drainActor &&
					!context.handledDrains.has(event.drain.token) &&
					(!context.transferLease || event.drain.lease.epoch >= context.transferLease.epoch),
				actions: [
					workflow.assign(({ context, event, self, spawn }) => {
						if (event.type !== 'WORKSPACE_DRAIN_REQUESTED')
							throw new Error('Unexpected selection event')
						context.handledDrains.add(event.drain.token)
						const workspace = context.workspace?.getSnapshot().context
						const owner =
							workspace?.resourceLease &&
							sameWorkspaceLease(workspace.resourceLease, event.drain.lease)
								? workspace.resourceActor
								: undefined
						const snapshot = owner?.getSnapshot()
						const actual =
							snapshot?.status === 'done'
								? snapshot.output
								: (workspace?.resourceResult ?? context.resourceResult)
						const transfers = required(self.getSnapshot().children.transferMutationOwner)
						const transferOwned =
							context.transferLease !== undefined &&
							sameWorkspaceLease(context.transferLease, event.drain.lease)
						const transferSnapshot = transfers.getSnapshot()
						const transferRelease: WorkspaceResourceRelease = !transferOwned
							? { outcome: 'released' }
							: transferSnapshot.status === 'done' && transferSnapshot.output.outcome === 'closed'
								? { outcome: 'released' }
								: { outcome: 'unresolved' }
						const release =
							actual && sameWorkspaceLease(actual.lease, event.drain.lease)
								? retainResourceRelease(context.cleanupRelease, actual.release)
								: context.cleanupRelease
						return {
							selectionDrain: event.drain,
							cleanupRelease: snapshot?.status === 'error' ? { outcome: 'unresolved' } : release,
							drainActor: spawn(createWorkspaceSelectionDrainMachine(), {
								input: {
									drain: event.drain,
									resources: snapshot?.status === 'active' ? owner : undefined,
									resourceRelease:
										snapshot?.status === 'error'
											? { outcome: 'unresolved' }
											: actual && sameWorkspaceLease(actual.lease, event.drain.lease)
												? actual.release
												: { outcome: 'released' },
									...(context.transferScope ? { transferScope: context.transferScope } : {}),
									transfers:
										transferOwned && transferSnapshot.status === 'active' ? transfers : undefined,
									transferRelease:
										transferOwned && transferSnapshot.status === 'active'
											? { outcome: 'released' }
											: transferRelease
								}
							})
						}
					})
				]
			},
			SELECTED_RESOURCES_RELEASED: {
				guard: ({ context, event }) =>
					currentSelectionScope(context, event.result.lease.scope) &&
					context.transferLease !== undefined &&
					sameWorkspaceLease(context.transferLease, event.result.lease),
				actions: workflow.enqueueActions(({ context, event, enqueue }) => {
					if (event.type !== 'SELECTED_RESOURCES_RELEASED')
						throw new Error('Unexpected selection event')
					enqueue.assign({
						resourceResult: event.result,
						cleanupRelease: retainResourceRelease(context.cleanupRelease, event.result.release)
					})
					if (
						context.drainActor?.getSnapshot().status === 'active' &&
						context.selectionDrain &&
						sameWorkspaceLease(context.selectionDrain.lease, event.result.lease)
					)
						enqueue.sendTo(context.drainActor, event)
					else if (
						context.selectionLease &&
						context.selectionFacts &&
						sameWorkspaceLease(context.selectionLease, event.result.lease) &&
						workspaceSelectionObservation(
							context.selectionFacts,
							event.result.lease.scope,
							event.result.lease.request,
							0
						).access === 'allowed'
					) {
						enqueue.assign({
							selectionLease: undefined,
							cleanupRelease: retainResourceRelease(context.cleanupRelease, {
								outcome:
									event.result.release.outcome === 'unresolved'
										? 'unresolved'
										: 'releasedWithFailure'
							})
						})
						enqueue.raise({ type: 'RESOURCE_OWNER_FAILED' })
					}
					if (event.result.release.outcome === 'unresolved')
						enqueue.raise({ type: 'CLEANUP_FAILED' })
				})
			},
			SELECTED_RESOURCES_CRASHED: {
				guard: ({ context, event }) =>
					currentSelectionScope(context, event.lease.scope) &&
					context.transferLease !== undefined &&
					sameWorkspaceLease(context.transferLease, event.lease),
				actions: workflow.enqueueActions(({ context, event, enqueue }) => {
					if (event.type !== 'SELECTED_RESOURCES_CRASHED')
						throw new Error('Unexpected selection event')
					enqueue.assign({
						resourceResult: {
							lease: event.lease,
							drain: undefined,
							release: { outcome: 'unresolved' }
						}
					})
					if (context.drainActor?.getSnapshot().status === 'active')
						enqueue.sendTo(context.drainActor, event)
					enqueue.raise({ type: 'CLEANUP_FAILED' })
				})
			},
			'xstate.done.actor.*': [
				{
					guard: ({ context, event }) =>
						context.workspace?.id === event.actorId && 'selectedResources' in event.output,
					actions: workflow.enqueueActions(({ context, event, enqueue }) => {
						if (!('output' in event) || !('selectedResources' in event.output))
							throw new Error('Missing workspace completion')
						enqueue.assign({
							cleanupRelease: retainResourceRelease(
								context.cleanupRelease,
								event.output.selectedResources
							)
						})
						enqueue(release)
						if (event.output.selectedResources.outcome === 'unresolved')
							enqueue.raise({ type: 'CLEANUP_FAILED' })
					})
				},
				{
					guard: ({ context, event }) =>
						event.actorId === context.drainActor?.id &&
						'drain' in event.output &&
						context.selectionDrain !== undefined &&
						event.output.drain.token === context.selectionDrain.token &&
						sameWorkspaceLease(event.output.drain.lease, context.selectionDrain.lease),
					actions: workflow.enqueueActions(({ context, event, enqueue }) => {
						if (!('output' in event) || !('drain' in event.output))
							throw new Error('Missing drain completion')
						const release = retainResourceRelease(context.cleanupRelease, event.output.release)
						enqueue.stopChild(required(context.drainActor))
						enqueue.assign({
							drainActor: undefined,
							selectionDrain: undefined,
							cleanupRelease: release
						})
						enqueue.sendTo('selectionAttachment', {
							type: 'SELECTION_COMMAND',
							binding: required(context.selectionBinding),
							command:
								release.outcome === 'released'
									? { type: 'DRAINED', drain: event.output.drain }
									: {
											type: 'DRAIN_FAILED',
											drain: event.output.drain,
											outcome: release.outcome === 'unresolved' ? 'unresolved' : 'released'
										}
						})
						if (release.outcome === 'unresolved') enqueue.raise({ type: 'CLEANUP_FAILED' })
					})
				}
			],
			WORKSPACE_DRAIN_FAILED: {
				guard: ({ context, event }) =>
					currentSelectionScope(context, event.drain.lease.scope) &&
					event.drain.token === context.selectionDrain?.token &&
					event.outcome === 'unresolved',
				actions: raise({ type: 'CLEANUP_FAILED' })
			}
		},
		states: {
			settlingResourceFailure: {
				entry: shutDownWorkspace,
				always: { guard: ({ context }) => workspaceReleased(context), target: 'resourceFailed' },
				on: {
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					START: {},
					RETRY: {},
					RECOVER: {},
					RETRY_NAVIGATION: {},
					RESOURCE_OWNER_FAILED: {}
				}
			},
			resourceFailed: {
				tags: 'startup-error',
				on: {
					RETRY: { target: 'running.preparingRetry' },
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					START: {},
					RECOVER: {},
					RETRY_NAVIGATION: {},
					RESOURCE_OWNER_FAILED: {}
				}
			},
			cleanupFailed: {
				tags: 'startup-error',
				entry: [
					shutDownWorkspace,
					workflow.enqueueActions(({ self, enqueue }) => {
						const owner = self.getSnapshot().children.transferMutationOwner
						if (owner?.getSnapshot().status === 'active')
							enqueue.sendTo(owner, { type: 'SHUTDOWN' })
					})
				],
				on: {
					START: {},
					RETRY: {},
					RECOVER: {},
					RETRY_NAVIGATION: {},
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					CLEANUP_FAILED: {},
					RESOURCE_OWNER_FAILED: {},
					STARTUP_UNAVAILABLE: {},
					OBSERVATION_UNAVAILABLE: {},
					ACQUIRED_STATUS: {}
				}
			},
			waitingForStartup: {
				on: {
					START: {
						target: 'opening',
						actions: [
							assign({ startupBinding: ({ event }) => event.startup }),
							sendTo('startup', ({ event }) => ({ type: 'START', ...event.startup }))
						]
					}
				}
			},
			opening: {
				on: {
					SESSION_ACQUIRED: {
						guard: 'currentStartup',
						target: 'bindingReadiness'
					},
					SESSION_STARTUP_FAILED: [
						{ guard: 'startupOwnerFailed', target: 'settlingStartupFailure' },
						{ guard: 'currentStartup', target: 'startupFailed' }
					]
				}
			},
			bindingReadiness: {
				invoke: {
					src: 'bindSessionReadiness',
					input: ({ event }) => {
						if (event.type !== 'SESSION_ACQUIRED') throw new Error('Missing acquired session')
						return event.session
					},
					onDone: {
						target: 'running',
						actions: [
							assign(({ event }) => ({
								session: event.output.session,
								readinessScope: { binding: event.output.readiness.binding, attachment: {} },
								observation: 0,
								retryAttempt: 0,
								observationFailure: undefined,
								status: 'transitioning'
							})),
							sendTo('sessionReadiness', ({ context, event }) => ({
								type: 'BIND',
								scope: required(context.readinessScope),
								capability: event.output.readiness.capability
							}))
						]
					},
					onError: 'settlingReadinessCrash'
				},
				on: { ATTACH_WORKSPACE: {}, ATTACH_PENDING: {}, RETRY: {} }
			},
			startupFailed: {
				tags: 'startup-error',
				on: {
					RETRY: {
						guard: ({ context }) =>
							context.startupBinding !== undefined &&
							context.startupBinding.scope.generation < Number.MAX_SAFE_INTEGER,
						target: 'opening',
						actions: [
							assign(({ context }) => ({
								startupBinding: {
									...required(context.startupBinding),
									scope: {
										...required(context.startupBinding).scope,
										generation: required(context.startupBinding).scope.generation + 1
									}
								}
							})),
							sendTo('startup', { type: 'RETRY' })
						]
					}
				}
			},
			settlingStartupFailure: {
				entry: [shutDownWorkspace, 'shutDownReadiness'],
				initial: 'releasingReadiness',
				states: {
					releasingReadiness: { on: { READINESS_RELEASED: 'workspace' } },
					workspace: {
						always: {
							guard: ({ context }) => workspaceReleased(context),
							target: '#application-readiness.startupActorFailed'
						}
					}
				},
				on: { ATTACH_WORKSPACE: {}, ATTACH_PENDING: {}, RETRY: {}, START: {} }
			},
			startupActorFailed: {
				tags: 'startup-error',
				on: {
					START: {
						target: '#application-readiness',
						reenter: true,
						actions: [assign({ session: undefined }), raise(({ event }) => event)]
					},
					RETRY: {
						target: '#application-readiness',
						reenter: true,
						guard: ({ context }) => context.startupBinding !== undefined,
						actions: [
							assign({ session: undefined }),
							raise(({ context }) => ({
								type: 'START',
								startup: {
									owner: required(context.startupBinding).owner,
									scope: {
										binding: required(context.startupBinding).scope.binding,
										attachment: {},
										generation: 0
									}
								}
							}))
						]
					}
				}
			},
			settlingReadinessCrash: {
				entry: shutDownWorkspace,
				always: { guard: ({ context }) => workspaceReleased(context), target: 'readinessCrashed' },
				on: {
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					RETRY: {},
					START: {},
					OBSERVATION_UNAVAILABLE: {},
					ACQUIRED_STATUS: {},
					STARTUP_UNAVAILABLE: {}
				}
			},
			readinessCrashed: {
				tags: 'startup-error',
				on: {
					RETRY: {},
					START: {},
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					OBSERVATION_UNAVAILABLE: {},
					ACQUIRED_STATUS: {},
					STARTUP_UNAVAILABLE: {}
				}
			},
			settlingObserverFailure: {
				entry: shutDownWorkspace,
				always: { guard: ({ context }) => workspaceReleased(context), target: 'observerFailed' },
				on: { ATTACH_WORKSPACE: {}, ATTACH_PENDING: {}, RETRY: {}, START: {} }
			},
			observerFailed: {
				tags: 'startup-error',
				on: {
					RETRY: [
						{
							guard: ({ context }) =>
								context.observationFailure !== undefined &&
								context.observation < Number.MAX_SAFE_INTEGER,
							target: 'running',
							actions: [
								assign(({ context }) => ({
									recoveryResult: undefined,
									observationFailure: undefined,
									observation: context.observation + 1,
									status: 'transitioning'
								})),
								sendTo('sessionReadiness', ({ context }) => ({
									type: 'REOBSERVE',
									scope: required(context.readinessScope),
									observation: context.observation
								}))
							]
						},
						{
							guard: ({ context }) => context.observationFailure === undefined,
							target: 'running',
							actions: assign({ recoveryResult: undefined })
						}
					],
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {}
				}
			},
			running: {
				initial: 'checking',
				invoke: [
					{
						id: 'mutationRejectionObserver',
						src: 'observeMutationRejections',
						input: ({ context }) => required(context.session)
					}
				],
				on: {
					MUTATION_REJECTED: {
						actions: assign(({ context, event }) => {
							const { transactionId } = event
							const tracked = context.trackedTransferWrites.find(
								(write) => write.transactionId === transactionId
							)
							return {
								trackedTransferWrites: context.trackedTransferWrites.filter(
									(write) => write.transactionId !== transactionId
								),
								mutationNotice: tracked
									? { kind: 'transfer', ...tracked }
									: { kind: 'generic', transactionId }
							}
						})
					},
					TRANSFER_WRITE_TRACKED: {
						actions: assign(({ context, event }) => {
							const trackedTransferWrites = [
								...context.trackedTransferWrites.filter(
									(write) => write.transactionId !== event.write.transactionId
								),
								event.write
							].slice(-64)
							const notice = context.mutationNotice
							return {
								trackedTransferWrites,
								mutationNotice:
									notice?.kind === 'generic' && notice.transactionId === event.write.transactionId
										? { kind: 'transfer', ...event.write }
										: notice
							}
						})
					},
					DISMISS_MUTATION_REJECTION: {
						actions: assign({ mutationNotice: undefined })
					},
					OBSERVATION_UNAVAILABLE: '#application-readiness.settlingObserverFailure',
					ACQUIRED_STATUS: {
						target: '.checking',
						actions: assign({ status: ({ event }) => event.status })
					},
					RETRY: { target: '.preparingRetry', actions: assign({ recoveryResult: undefined }) },
					RECOVER: {
						guard: ({ context }) => context.status === 'ready',
						target: '.recovering',
						actions: assign({
							recoveryAttempt: ({ context }) => context.recoveryAttempt + 1,
							recoveryResult: undefined,
							recoveryRequest: ({ event }): RecoveryRequest => ({
								kind: 'restore',
								phrase: event.phrase,
								origin: event.origin,
								destination: event.destination
							})
						})
					},
					RETRY_NAVIGATION: {
						guard: ({ context }) =>
							context.status === 'ready' &&
							context.recoveryResult?.outcome === 'navigationFailed' &&
							context.recoveryResult.navigation !== undefined,
						target: '.recovering',
						actions: assign({
							recoveryAttempt: ({ context }) => context.recoveryAttempt + 1,
							recoveryRequest: ({ context }): RecoveryRequest => {
								const result = context.recoveryResult
								if (result?.outcome !== 'navigationFailed')
									throw new Error('Missing navigation retry')
								return { kind: 'navigate', ...required(result.navigation) }
							},
							recoveryResult: undefined
						})
					}
				},
				states: {
					checking: {
						always: [
							{ guard: ({ context }) => context.status === 'ready', target: 'ready' },
							{ guard: ({ context }) => context.status === 'error', target: 'failed' },
							{ guard: ({ context }) => context.status === 'signed-out', target: 'signedOut' },
							{ guard: ({ context }) => context.status === 'closed', target: 'closed' },
							{ target: 'transitioning' }
						]
					},
					ready: {},
					failed: { tags: 'startup-error' },
					retryFailed: {
						tags: 'startup-error',
						on: {
							ACQUIRED_STATUS: { actions: assign({ status: ({ event }) => event.status }) },
							RECOVER: {},
							RETRY_NAVIGATION: {},
							ATTACH_WORKSPACE: {},
							ATTACH_PENDING: {}
						}
					},
					signedOut: {},
					closed: {},
					transitioning: {},
					preparingRetry: {
						entry: shutDownWorkspace,
						always: {
							guard: ({ context }) =>
								workspaceReleased(context) && context.retryAttempt < Number.MAX_SAFE_INTEGER,
							target: 'retrying'
						},
						on: {
							START: {},
							RETRY: {},
							RECOVER: {},
							RETRY_NAVIGATION: {},
							ACQUIRED_STATUS: { actions: assign({ status: ({ event }) => event.status }) },
							ATTACH_WORKSPACE: { actions: retainAttachment },
							ATTACH_PENDING: {}
						}
					},
					retrying: {
						initial: 'active',
						entry: [
							assign(({ context }) => ({ retryAttempt: context.retryAttempt + 1 })),
							sendTo('sessionReadiness', ({ context }) => ({
								type: 'RETRY',
								scope: required(context.readinessScope),
								attempt: context.retryAttempt
							}))
						],
						on: {
							RESOURCE_OWNER_FAILED: '.observerFailed',
							CLEANUP_FAILED: {
								target: '.cleanupFailed',
								actions: assign({ cleanupRelease: { outcome: 'unresolved' } })
							},
							SESSION_RETRY_SETTLED: [
								{
									guard: and(['currentRetry', 'retryCleanupFailed']),
									target: '#application-readiness.cleanupFailed'
								},
								{
									guard: and(['currentRetry', 'shuttingDown']),
									target: '#application-readiness.closing',
									actions: 'refreshAttachment'
								},
								{
									guard: and(['currentRetry', 'retryStartupFailed']),
									target: '#application-readiness.settlingStartupFailure',
									actions: 'refreshAttachment'
								},
								{
									guard: and(['currentRetry', 'retryObserverFailed']),
									target: '#application-readiness.settlingObserverFailure',
									actions: 'refreshAttachment'
								},
								{
									guard: and(['currentRetry', ({ event }) => event.outcome === 'rejected']),
									target: '#application-readiness.running.retryFailed',
									actions: 'refreshAttachment'
								},
								{ guard: 'currentRetry', target: '.awaitingStatus' }
							],
							ATTACH_WORKSPACE: { actions: retainAttachment },
							ATTACH_PENDING: {},
							START: {},
							RECOVER: {},
							RETRY_NAVIGATION: {},
							RETRY: {},
							ACQUIRED_STATUS: { actions: assign({ status: ({ event }) => event.status }) },
							OBSERVATION_UNAVAILABLE: '.observerFailed',
							'xstate.error.actor.sessionReadiness':
								'#application-readiness.settlingReadinessCrash',
							'xstate.error.actor.startup': { target: '.startupFailed', actions: 'retireStartup' },
							STARTUP_UNAVAILABLE: '.startupFailed',
							'xstate.error.actor.*': {
								guard: ({ context, event }) => context.workspace?.id === event.actorId,
								target: '.observerFailed',
								actions: release
							},
							SHUTDOWN: '.closing'
						},
						states: {
							active: {},
							awaitingStatus: {
								on: {
									SESSION_RETRY_SETTLED: {},
									ACQUIRED_STATUS: {
										guard: ({ context, event }) => event.afterRetry === context.retryAttempt,
										target: '#application-readiness.running.checking',
										actions: [assign({ status: ({ event }) => event.status }), 'refreshAttachment']
									},
									OBSERVATION_UNAVAILABLE: {
										target: '#application-readiness.settlingObserverFailure',
										actions: 'refreshAttachment'
									},
									STARTUP_UNAVAILABLE: {
										target: '#application-readiness.settlingStartupFailure',
										actions: 'refreshAttachment'
									},
									'xstate.error.actor.startup': {
										target: '#application-readiness.settlingStartupFailure',
										actions: ['refreshAttachment', 'retireStartup']
									},
									SHUTDOWN: {
										target: '#application-readiness.closing',
										actions: 'refreshAttachment'
									}
								}
							},
							cleanupFailed: {
								...retryDrain,
								on: {
									...retryDrain.on,
									STARTUP_UNAVAILABLE: {},
									OBSERVATION_UNAVAILABLE: {},
									CLEANUP_FAILED: {},
									RESOURCE_OWNER_FAILED: {},
									'xstate.error.actor.startup': { actions: 'retireStartup' },
									'xstate.error.actor.sessionReadiness': {}
								}
							},
							observerFailed: retryDrain,
							startupFailed: {
								...retryDrain,
								entry: [shutDownWorkspace, 'shutDownReadiness'],
								on: {
									...retryDrain.on,
									'xstate.error.actor.startup': { actions: 'retireStartup' },
									STARTUP_UNAVAILABLE: {},
									'xstate.error.actor.*': {
										guard: ({ context, event }) => context.workspace?.id === event.actorId,
										actions: release
									}
								}
							},
							closing: {
								...retryDrain,
								entry: [shutDownWorkspace, 'shutDownReadiness'],
								on: {
									...retryDrain.on,
									'xstate.error.actor.sessionReadiness': '#application-readiness.closing',
									'xstate.error.actor.startup': { actions: 'retireStartup' },
									STARTUP_UNAVAILABLE: {},
									SHUTDOWN: {},
									'xstate.error.actor.*': {
										guard: ({ context, event }) => context.workspace?.id === event.actorId,
										actions: release
									}
								}
							}
						}
					},
					recovering: {
						initial: 'validating',
						invoke: {
							id: 'recovery',
							src: 'recovery',
							input: ({ context }) => ({
								attempt: context.recoveryAttempt,
								request: required(context.recoveryRequest),
								session: required(context.session),
								restorationBinding:
									context.recoveryRequest?.kind === 'restore'
										? bindRestoration?.(required(context.session))
										: undefined,
								...navigation
							}),
							onDone: [
								{
									guard: 'recoveryCleanupFailed',
									target: '#application-readiness.cleanupFailed',
									actions: assign({ recoveryRequest: undefined })
								},
								{
									guard: 'recoveryClosing',
									target: '#application-readiness.closing',
									actions: assign({ recoveryRequest: undefined })
								},
								{
									guard: 'recoveryReadinessCrashed',
									target: '#application-readiness.settlingReadinessCrash',
									actions: assign({ recoveryRequest: undefined })
								},
								{
									guard: 'recoveryStartupFailed',
									target: '#application-readiness.settlingStartupFailure',
									actions: assign({ recoveryRequest: undefined })
								},
								{
									guard: 'recoveryObserverFailed',
									target: '#application-readiness.settlingObserverFailure',
									actions: assign({ recoveryRequest: undefined })
								},
								{
									target: 'checking',
									actions: [
										assign(({ context, event }) => ({
											recoveryResult: event.output,
											recoveryRequest: undefined,
											attachmentRevision:
												context.attachmentRevision + (event.output.mutation === 'settled' ? 1 : 0),
											pending: event.output.mutation === 'settled' ? undefined : context.pending
										})),
										raise({ type: 'ATTACH_PENDING' })
									]
								}
							],
							onError: [
								{
									guard: 'recoveryCleanupFailed',
									target: '#application-readiness.cleanupFailed',
									actions: assign({ recoveryRequest: undefined })
								},
								{
									guard: 'recoveryClosing',
									target: '#application-readiness.closing',
									actions: assign({ recoveryRequest: undefined })
								},
								{
									guard: 'recoveryReadinessCrashed',
									target: '#application-readiness.settlingReadinessCrash',
									actions: assign({ recoveryRequest: undefined })
								},
								{
									guard: 'recoveryStartupFailed',
									target: '#application-readiness.settlingStartupFailure',
									actions: assign({ recoveryRequest: undefined })
								},
								{
									target: '#application-readiness.settlingObserverFailure',
									actions: assign({ recoveryRequest: undefined })
								}
							]
						},
						on: {
							START: {},
							RETRY: {},
							RECOVER: {},
							RETRY_NAVIGATION: {},
							ATTACH_WORKSPACE: { actions: retainAttachment },
							ATTACH_PENDING: {},
							ACQUIRED_STATUS: { actions: assign({ status: ({ event }) => event.status }) },
							RESOURCE_OWNER_FAILED: '.observerFailed',
							CLEANUP_FAILED: {
								target: '.cleanupFailed',
								actions: assign({ cleanupRelease: { outcome: 'unresolved' } })
							},
							RECOVERY_VALIDATED: {
								guard: ({ context, event }) => event.attempt === context.recoveryAttempt,
								actions: assign({
									recoveryRequest: undefined,
									recoveryDraftRevision: ({ context }) => context.recoveryDraftRevision + 1
								})
							},
							RECOVERY_DRAIN_REQUESTED: {
								guard: ({ context, event }) => event.attempt === context.recoveryAttempt,
								target: '.draining'
							},
							OBSERVATION_UNAVAILABLE: '.observerFailed',
							'xstate.error.actor.sessionReadiness': '.readinessCrashed',
							'xstate.error.actor.startup': { target: '.startupFailed', actions: 'retireStartup' },
							STARTUP_UNAVAILABLE: '.startupFailed',
							'xstate.error.actor.*': {
								guard: ({ context, event }) => context.workspace?.id === event.actorId,
								target: '.observerFailed',
								actions: release
							},
							SHUTDOWN: '.closing'
						},
						states: {
							validating: {},
							draining: {
								entry: shutDownWorkspace,
								always: {
									guard: ({ context }) => workspaceReleased(context),
									target: 'operating',
									actions: sendTo('recovery', { type: 'WORKSPACE_DRAINED' })
								}
							},
							operating: {},
							cleanupFailed: {
								...recoveryDrain,
								on: {
									...recoveryDrain.on,
									STARTUP_UNAVAILABLE: {},
									OBSERVATION_UNAVAILABLE: {},
									CLEANUP_FAILED: {},
									RESOURCE_OWNER_FAILED: {},
									'xstate.error.actor.startup': { actions: 'retireStartup' },
									'xstate.error.actor.sessionReadiness': {}
								}
							},
							observerFailed: recoveryDrain,
							readinessCrashed: {
								...recoveryDrain,
								on: {
									...recoveryDrain.on,
									'xstate.error.actor.sessionReadiness': {},
									'xstate.error.actor.startup': { actions: 'retireStartup' },
									STARTUP_UNAVAILABLE: {}
								}
							},
							startupFailed: {
								...recoveryDrain,
								entry: [shutDownWorkspace, shutDownRecovery, 'shutDownReadiness'],
								on: {
									...recoveryDrain.on,
									'xstate.error.actor.startup': { actions: 'retireStartup' },
									STARTUP_UNAVAILABLE: {},
									'xstate.error.actor.*': {
										guard: ({ context, event }) => context.workspace?.id === event.actorId,
										actions: release
									}
								}
							},
							closing: {
								...recoveryDrain,
								entry: [shutDownWorkspace, shutDownRecovery, 'shutDownReadiness'],
								on: {
									...recoveryDrain.on,
									'xstate.error.actor.sessionReadiness': {},
									SHUTDOWN: {},
									'xstate.error.actor.startup': { actions: 'retireStartup' },
									STARTUP_UNAVAILABLE: {},
									'xstate.error.actor.*': {
										guard: ({ context, event }) => context.workspace?.id === event.actorId,
										actions: release
									}
								}
							}
						}
					}
				}
			},
			closing: {
				initial: 'workspace',
				states: {
					workspace: {
						always: [
							{
								guard: ({ context }) => context.cleanupRelease.outcome === 'unresolved',
								target: '#application-readiness.cleanupFailed'
							},
							{ guard: ({ context }) => workspaceReleased(context), target: 'transfers' }
						]
					},
					transfers: {
						entry: workflow.enqueueActions(({ self, enqueue }) => {
							const owner = self.getSnapshot().children.transferMutationOwner
							if (owner?.getSnapshot().status === 'active')
								enqueue.sendTo(owner, { type: 'SHUTDOWN' })
						}),
						always: {
							guard: ({ context }) => context.transferMutationOwnerClosed,
							target: '#application-readiness.releasingReadiness'
						}
					}
				},
				entry: [
					'shutDownReadiness',
					workflow.enqueueActions(({ context, enqueue }) => {
						enqueue(detachSelection)
						if (context.workspace?.getSnapshot().status === 'active')
							enqueue.sendTo(context.workspace, { type: 'SHUTDOWN' })
					})
				],
				on: {
					STARTUP_UNAVAILABLE: {},
					'xstate.error.actor.*': [
						{ guard: ({ event }) => event.actorId === 'startup', actions: 'retireStartup' },
						{
							guard: ({ context, event }) => context.workspace?.id === event.actorId,
							actions: release
						}
					],
					WORKSPACE_CLOSED: {},
					TRANSFER_MUTATION_OWNER_CLOSED: {
						actions: assign({ transferMutationOwnerClosed: true })
					},
					ATTACH_WORKSPACE: {},
					DETACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					SHUTDOWN: {},
					START: {},
					RETRY: {}
				}
			},
			releasingReadiness: {
				entry: 'shutDownReadiness',
				on: {
					READINESS_RELEASED: 'releasingStartup',
					SHUTDOWN: {},
					STARTUP_UNAVAILABLE: {},
					OBSERVATION_UNAVAILABLE: {},
					ACQUIRED_STATUS: {},
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {}
				}
			},
			releasingStartup: {
				entry: workflow.enqueueActions(({ self, enqueue }) => {
					const child = self.getSnapshot().children.startup
					if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'SHUTDOWN' })
					else enqueue.raise({ type: 'STARTUP_RELEASED' })
				}),
				on: {
					STARTUP_RELEASED: 'closed',
					STARTUP_UNAVAILABLE: {},
					SHUTDOWN: {},
					ATTACH_WORKSPACE: {},
					DETACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					START: {},
					RETRY: {},
					SESSION_ACQUIRED: {},
					SESSION_STARTUP_FAILED: {}
				}
			},
			closed: {
				type: 'final',
				entry: assign({
					workspace: undefined,
					attachment: undefined,
					pending: undefined,
					session: undefined,
					startupBinding: undefined,
					readinessScope: undefined,
					observationFailure: undefined
				})
			}
		}
	})
}

/** Match the exact dependency attachment, including while a previous owner drains. */
export function selectAttachedWorkspace(
	snapshot: SnapshotFrom<ReturnType<typeof createApplicationReadinessMachine>>,
	attachment: WorkspaceAttachment
) {
	return snapshot.context.attachment === attachment ? snapshot.context.workspace : undefined
}

export function selectRecoveryView(
	snapshot: SnapshotFrom<ReturnType<typeof createApplicationReadinessMachine>>
) {
	const result = snapshot.context.recoveryResult
	return {
		busy: snapshot.matches({ running: 'recovering' }),
		navigationOnly: snapshot.context.recoveryRequest?.kind === 'navigate',
		invalid: result?.outcome === 'invalid',
		failed: result?.outcome === 'restoreFailed',
		navigationFailed: result?.outcome === 'navigationFailed',
		canRetryNavigation: result?.outcome === 'navigationFailed' && result.navigation !== undefined,
		draftRevision: snapshot.context.recoveryDraftRevision
	}
}

function contextTransferScope(
	context: Context,
	request: TransferMutationRequestInput
): TransferMutationScope | undefined {
	const { selectionLease: lease, attachment, selectionFacts } = context
	if (
		!lease ||
		!context.transferLease ||
		!sameWorkspaceLease(lease, context.transferLease) ||
		!attachment ||
		!selectionFacts ||
		!context.workspace?.getSnapshot().matches('active') ||
		context.cleanupRelease.outcome === 'unresolved' ||
		context.pending ||
		request.input.db !== attachment.dependencies.db ||
		request.input.identityId !== selectionFacts.source.userId ||
		request.workspaceId !== lease.request.workspaceId ||
		request.input.organizationId !== lease.request.workspaceId ||
		workspaceSelectionTarget(selectionFacts) !== lease.request.workspaceId ||
		workspaceSelectionObservation(selectionFacts, lease.scope, lease.request, 0).access !==
			'allowed'
	)
		return undefined
	return context.transferScope
}

/** Capture once at request creation. Submission must validate, never relabel, this scope. */
export function captureTransferMutationScope(
	snapshot: SnapshotFrom<ReturnType<typeof createApplicationReadinessMachine>>,
	request: TransferMutationRequestInput
): TransferMutationScope | undefined {
	return snapshot.matches({ running: 'ready' })
		? contextTransferScope(snapshot.context, request)
		: undefined
}
