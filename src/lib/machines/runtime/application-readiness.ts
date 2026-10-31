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
	setup,
	stopChild
} from 'xstate'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'
import type { JazzClient, JazzSession } from 'jazz-tools/svelte'
import type { MutationErrorEvent } from 'jazz-tools'
import type { TransferWriteTracking } from '../transfers/internal-transfer.js'
import {
	createInternalTransferMutationOwner,
	type TransferMutationRequest
} from '../transfers/internal-transfer-mutation-owner.js'
import { createSessionStartupMachine } from 'delightful-local-first/session/workflow'
import type { SessionStartupReport } from 'delightful-local-first/session/contracts'
import type { JazzStartupBinding } from '#lib/runtime/jazz-session.js'
import { createWorkspaceReadinessMachine, type WorkspaceAttachment } from './readiness.js'
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
type Status = ReturnType<Session['getSnapshot']>['status']
export type MutationNotice =
	| { kind: 'generic'; transactionId: string }
	| {
			kind: 'transfer'
			operation: TransferWriteTracking['operation']
			transactionId: string
			transferId: string
	  }
type Context = {
	attachmentRevision: number
	recoveryDraftRevision: number
	recoveryAttempt: number
	recoveryRequest: RecoveryRequest | undefined
	recoveryResult: RecoveryResult | undefined
	session: Session | undefined
	startupBinding: JazzStartupBinding | undefined
	status: Status
	workspace: Workspace | undefined
	attachment: WorkspaceAttachment | undefined
	pending: WorkspaceAttachment | undefined
	trackedTransferWrites: TransferWriteTracking[]
	mutationNotice: MutationNotice | undefined
	transferMutationOwnerClosed: boolean
}
type Event =
	| RecoveryNotice
	| SessionStartupReport<Session>
	| { type: 'RECOVER'; phrase: string; origin: string; destination: string }
	| { type: 'RETRY_NAVIGATION' }
	| { type: 'START'; startup: JazzStartupBinding }
	| { type: 'STARTUP_RELEASED' }
	| { type: 'STARTUP_UNAVAILABLE' }
	| { type: 'RETRY' }
	| { type: 'SESSION_OBSERVED'; status: Status }
	| { type: 'SESSION_OBSERVER_FAILED' }
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

/** Hosts enabling RECOVER supply the layout-owned binding factory; other lifecycles need none. */
export function createApplicationReadinessMachine(
	navigation: { readHref: () => string; navigate: (destination: string) => Promise<void> } = {
		readHref: () => '',
		navigate: async () => {
			throw new Error('Navigation unavailable')
		}
	},
	bindRestoration?: (session: Session) => RecoveryRestorationBinding
) {
	const actors = {
		recovery: sessionRecoveryMachine,
		transferMutationOwner: createInternalTransferMutationOwner(),
		startup: createSessionStartupMachine<Session>(),
		observeSession: fromCallback<Event, Session>(({ input, sendBack }) => {
			// SDK notifications execute outside XState; bridge their failures explicitly.
			const publish = () => {
				try {
					sendBack({ type: 'SESSION_OBSERVED', status: input.getSnapshot().status })
				} catch {
					sendBack({ type: 'SESSION_OBSERVER_FAILED' })
				}
			}
			publish()
			return input.subscribe(publish)
		}),
		observeMutationRejections: fromCallback<Event, Session>(({ input, sendBack }) => {
			const db = input.getSnapshot().client?.db
			if (!db) return
			return db.onMutationError((rejection) => {
				sendBack({
					type: 'MUTATION_REJECTED',
					transactionId: rejection.transaction.transactionId
				})
			})
		}),
		retrySession: fromPromise(({ input }: { input: Session }) => input.retry())
	}
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{},
		{ refreshAttachment: undefined; retireStartup: undefined },
		{
			startupOwnerFailed: undefined
			currentStartup: undefined
			shuttingDown: undefined
			retryObserverFailed: undefined
			retryStartupFailed: undefined
			recoveryClosing: undefined
			recoveryObserverFailed: undefined
			recoveryStartupFailed: undefined
		},
		never,
		string
	>({
		actors,
		actions: {
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
				stateIn({ running: { retrying: 'closing' } }),
				stateIn({ running: { recovering: 'closing' } })
			]),
			retryObserverFailed: stateIn({ running: { retrying: 'observerFailed' } }),
			retryStartupFailed: stateIn({ running: { retrying: 'startupFailed' } }),
			recoveryClosing: stateIn({ running: { recovering: 'closing' } }),
			recoveryObserverFailed: stateIn({ running: { recovering: 'observerFailed' } }),
			recoveryStartupFailed: stateIn({ running: { recovering: 'startupFailed' } })
		}
	})
	const attach = workflow.assign(({ context, spawn }) => ({
		attachment: context.pending,
		workspace: spawn(createWorkspaceReadinessMachine(required(context.pending))),
		pending: undefined
	}))
	const shutDownWorkspace = workflow.enqueueActions(({ context, enqueue }) => {
		enqueue.assign({ pending: undefined })
		enqueue.sendTo('transferMutationOwner', {
			type: 'TRANSFER_SCOPE_CHANGED',
			workspaceId: undefined
		})
		if (context.workspace?.getSnapshot().status === 'active')
			enqueue.sendTo(context.workspace, { type: 'SHUTDOWN' })
	})
	const release = workflow.enqueueActions(({ context, enqueue }) => {
		enqueue.stopChild(required(context.workspace))
		enqueue.assign({ workspace: undefined, attachment: undefined })
		enqueue.raise({ type: 'ATTACH_PENDING' })
	})
	// These states retain the parent's issued retry while its observer and workspace drain.
	const retryDrain = workflow.createStateConfig({
		entry: [stopChild('sessionObserver'), shutDownWorkspace],
		on: {
			SESSION_OBSERVED: {},
			SESSION_OBSERVER_FAILED: {},
			'xstate.error.actor.sessionObserver': {},
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
	const recoveryDrain = workflow.createStateConfig({
		entry: [
			stopChild('sessionObserver'),
			shutDownWorkspace,
			workflow.enqueueActions(({ self, enqueue }) => {
				const child = self.getSnapshot().children.recovery
				if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'SHUTDOWN' })
			})
		],
		on: {
			SESSION_OBSERVED: {},
			SESSION_OBSERVER_FAILED: {},
			'xstate.error.actor.sessionObserver': {},
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
		context: {
			attachmentRevision: 0,
			recoveryDraftRevision: 0,
			recoveryAttempt: 0,
			recoveryRequest: undefined,
			recoveryResult: undefined,
			session: undefined,
			startupBinding: undefined,
			status: 'transitioning',
			workspace: undefined,
			attachment: undefined,
			pending: undefined,
			trackedTransferWrites: [],
			mutationNotice: undefined,
			transferMutationOwnerClosed: false
		},
		invoke: [
			{
				id: 'startup',
				src: 'startup',
				input: ({ self }) => ({ reportTo: self }),
				onDone: [
					{ guard: 'shuttingDown', actions: raise({ type: 'STARTUP_RELEASED' }) },
					{ target: '.settlingStartupFailure' }
				],
				onError: [
					{
						guard: 'shuttingDown',
						actions: ['retireStartup', raise({ type: 'STARTUP_RELEASED' })]
					},
					{ target: '.settlingStartupFailure', actions: 'retireStartup' }
				]
			},
			{ id: 'transferMutationOwner', src: 'transferMutationOwner' }
		],
		on: {
			'xstate.error.actor.*': [
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
			SESSION_STARTING: {},
			SESSION_ACQUIRED: {},
			SESSION_STARTUP_FAILED: {
				guard: 'currentStartup',
				actions: raise({ type: 'STARTUP_UNAVAILABLE' })
			},
			STARTUP_UNAVAILABLE: { target: '.settlingStartupFailure' },
			TRANSFER_MUTATION_REQUEST: {
				actions: sendTo('transferMutationOwner', ({ event }) => ({
					type: 'REQUEST_TRANSFER_MUTATION',
					request: event.request
				}))
			},
			CANCEL_TRANSFER_MUTATION: {
				actions: sendTo('transferMutationOwner', ({ event }) => event)
			},
			WORKSPACE_SCOPE_OBSERVED: {
				actions: sendTo('transferMutationOwner', ({ event }) => ({
					type: 'TRANSFER_SCOPE_CHANGED',
					workspaceId: event.workspaceId
				}))
			},
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
					guard: ({ context }) => Boolean(context.workspace),
					actions: [
						assign({ pending: ({ event }) => event.attachment }),
						sendTo(({ context }) => required(context.workspace), { type: 'SHUTDOWN' }),
						sendTo('transferMutationOwner', ({ event }) => ({
							type: 'TRANSFER_SCOPE_CHANGED',
							workspaceId: event.attachment.dependencies.read().organizationId ?? undefined
						}))
					]
				},
				{
					actions: [
						sendTo('transferMutationOwner', ({ event }) => ({
							type: 'TRANSFER_SCOPE_CHANGED',
							workspaceId: event.attachment.dependencies.read().organizationId ?? undefined
						})),
						assign({ pending: ({ event }) => event.attachment }),
						attach
					]
				}
			],
			DETACH_WORKSPACE: [
				{
					guard: ({ context, event }) => context.pending === event.attachment,
					actions: assign({ pending: undefined })
				},
				{
					guard: ({ context, event }) =>
						context.attachment === event.attachment &&
						context.workspace?.getSnapshot().status === 'active',
					actions: [
						sendTo(({ context }) => required(context.workspace), { type: 'SHUTDOWN' }),
						sendTo('transferMutationOwner', {
							type: 'TRANSFER_SCOPE_CHANGED',
							workspaceId: undefined
						})
					]
				}
			],
			WORKSPACE_CLOSED: {
				guard: ({ context, event }) => context.workspace === event.actor,
				actions: release
			},
			ATTACH_PENDING: {
				guard: ({ context }) => Boolean(context.pending),
				actions: [
					sendTo('transferMutationOwner', ({ context }) => ({
						type: 'TRANSFER_SCOPE_CHANGED',
						workspaceId: required(context.pending).dependencies.read().organizationId ?? undefined
					})),
					attach
				]
			}
		},
		states: {
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
						target: 'running',
						actions: assign({ session: ({ event }) => event.session })
					},
					SESSION_STARTUP_FAILED: [
						{ guard: 'startupOwnerFailed', target: 'settlingStartupFailure' },
						{ guard: 'currentStartup', target: 'startupFailed' }
					]
				}
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
				entry: shutDownWorkspace,
				always: { guard: ({ context }) => !context.workspace, target: 'startupActorFailed' },
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
			settlingObserverFailure: {
				entry: shutDownWorkspace,
				always: { guard: ({ context }) => !context.workspace, target: 'observerFailed' },
				on: { ATTACH_WORKSPACE: {}, ATTACH_PENDING: {}, RETRY: {}, START: {} }
			},
			observerFailed: {
				tags: 'startup-error',
				on: {
					RETRY: { target: 'running', actions: assign({ recoveryResult: undefined }) },
					ATTACH_WORKSPACE: {},
					ATTACH_PENDING: {}
				}
			},
			running: {
				initial: 'checking',
				invoke: [
					{
						id: 'sessionObserver',
						src: 'observeSession',
						input: ({ context }) => required(context.session),
						onError: '#application-readiness.settlingObserverFailure'
					},
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
					SESSION_OBSERVER_FAILED: '#application-readiness.settlingObserverFailure',
					SESSION_OBSERVED: {
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
					signedOut: {},
					closed: {},
					transitioning: {},
					preparingRetry: {
						entry: shutDownWorkspace,
						always: { guard: ({ context }) => !context.workspace, target: 'retrying' },
						on: {
							START: {},
							RETRY: {},
							RECOVER: {},
							RETRY_NAVIGATION: {},
							SESSION_OBSERVED: { actions: assign({ status: ({ event }) => event.status }) },
							ATTACH_WORKSPACE: { actions: retainAttachment },
							ATTACH_PENDING: {}
						}
					},
					retrying: {
						initial: 'active',
						invoke: {
							src: 'retrySession',
							input: ({ context }) => required(context.session),
							onDone: [
								{
									guard: 'shuttingDown',
									target: '#application-readiness.closing',
									actions: 'refreshAttachment'
								},
								{
									guard: 'retryStartupFailed',
									target: '#application-readiness.settlingStartupFailure',
									actions: 'refreshAttachment'
								},
								{
									guard: 'retryObserverFailed',
									target: '#application-readiness.settlingObserverFailure',
									actions: 'refreshAttachment'
								},
								{
									target: '#application-readiness.running.checking',
									actions: 'refreshAttachment'
								}
							],
							onError: [
								{
									guard: 'shuttingDown',
									target: '#application-readiness.closing',
									actions: 'refreshAttachment'
								},
								{
									guard: 'retryStartupFailed',
									target: '#application-readiness.settlingStartupFailure',
									actions: 'refreshAttachment'
								},
								{
									guard: 'retryObserverFailed',
									target: '#application-readiness.settlingObserverFailure',
									actions: 'refreshAttachment'
								},
								{
									target: '#application-readiness.running.failed',
									actions: 'refreshAttachment'
								}
							]
						},
						on: {
							ATTACH_WORKSPACE: { actions: retainAttachment },
							ATTACH_PENDING: {},
							START: {},
							RECOVER: {},
							RETRY_NAVIGATION: {},
							RETRY: {},
							SESSION_OBSERVED: { actions: assign({ status: ({ event }) => event.status }) },
							SESSION_OBSERVER_FAILED: '.observerFailed',
							'xstate.error.actor.sessionObserver': '.observerFailed',
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
							observerFailed: retryDrain,
							startupFailed: {
								...retryDrain,
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
								on: {
									...retryDrain.on,
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
									guard: 'recoveryClosing',
									target: '#application-readiness.closing',
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
									guard: 'recoveryClosing',
									target: '#application-readiness.closing',
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
							SESSION_OBSERVED: { actions: assign({ status: ({ event }) => event.status }) },
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
							SESSION_OBSERVER_FAILED: '.observerFailed',
							'xstate.error.actor.sessionObserver': '.observerFailed',
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
									guard: ({ context }) => !context.workspace,
									target: 'operating',
									actions: sendTo('recovery', { type: 'WORKSPACE_DRAINED' })
								}
							},
							operating: {},
							observerFailed: recoveryDrain,
							startupFailed: {
								...recoveryDrain,
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
								on: {
									...recoveryDrain.on,
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
				always: {
					guard: ({ context }) => !context.workspace && context.transferMutationOwnerClosed,
					target: 'releasingStartup'
				},
				entry: workflow.enqueueActions(({ context, enqueue }) => {
					enqueue.sendTo('transferMutationOwner', { type: 'SHUTDOWN' })
					if (context.workspace?.getSnapshot().status === 'active')
						enqueue.sendTo(context.workspace, { type: 'SHUTDOWN' })
				}),
				on: {
					STARTUP_UNAVAILABLE: {},
					'xstate.error.actor.*': [
						{ guard: ({ event }) => event.actorId === 'startup', actions: 'retireStartup' },
						{
							guard: ({ context, event }) => context.workspace?.id === event.actorId,
							actions: release
						},
						{}
					],
					WORKSPACE_CLOSED: {
						guard: ({ context, event }) => context.workspace === event.actor,
						actions: [
							stopChild(({ context }) => required(context.workspace)),
							assign({ workspace: undefined, attachment: undefined })
						]
					},
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
					startupBinding: undefined
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
