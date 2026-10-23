import {
	assign,
	fromCallback,
	fromPromise,
	not,
	or,
	stateIn,
	raise,
	sendTo,
	setup,
	stopChild
} from 'xstate'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'
import type { JazzClient, JazzSession } from 'jazz-tools/svelte'
import { createSessionStartupMachine } from './session-startup.js'
import { createWorkspaceReadinessMachine, type WorkspaceAttachment } from './readiness.js'
import { required } from './bank-sync/identity.js'

type Session = JazzSession<JazzClient>
type Workspace = ActorRefFrom<ReturnType<typeof createWorkspaceReadinessMachine>>
type Status = ReturnType<Session['getSnapshot']>['status']
type Context = {
	session: Session | undefined
	status: Status
	workspace: Workspace | undefined
	attachment: WorkspaceAttachment | undefined
	pending: WorkspaceAttachment | undefined
}
type Event =
	| { type: 'START' }
	| { type: 'RETRY' }
	| { type: 'SESSION_OBSERVED'; status: Status }
	| { type: 'SESSION_OBSERVER_FAILED' }
	| { type: 'ATTACH_WORKSPACE'; attachment: WorkspaceAttachment }
	| { type: 'DETACH_WORKSPACE'; attachment: WorkspaceAttachment }
	| { type: 'WORKSPACE_CLOSED'; actor: unknown }
	| { type: 'ATTACH_PENDING' }
	| { type: 'SHUTDOWN' }
	| { type: `xstate.error.actor.${string}`; actorId: string; error: unknown }

export function createApplicationReadinessMachine(
	open: () => Promise<Session>,
	existing: Session | undefined
) {
	const actors = {
		startup: createSessionStartupMachine(open, existing),
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
		retrySession: fromPromise(({ input }: { input: Session }) => input.retry())
	}
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{
			acceptStartup: undefined
			shuttingDown: undefined
			retryObserverFailed: undefined
			retryStartupFailed: undefined
		},
		never,
		string
	>({
		actors,
		guards: {
			acceptStartup: or([stateIn('opening'), stateIn('startupFailed')]),
			shuttingDown: or([stateIn('closing'), stateIn({ running: { retrying: 'closing' } })]),
			retryObserverFailed: stateIn({ running: { retrying: 'observerFailed' } }),
			retryStartupFailed: stateIn({ running: { retrying: 'startupFailed' } })
		}
	})
	const attach = workflow.assign(({ context, spawn }) => ({
		attachment: context.pending,
		workspace: spawn(createWorkspaceReadinessMachine(required(context.pending)), {
			syncSnapshot: true
		}),
		pending: undefined
	}))
	const shutDownWorkspace = workflow.enqueueActions(({ context, enqueue }) => {
		enqueue.assign({ pending: undefined })
		if (context.workspace) enqueue.sendTo(context.workspace, { type: 'SHUTDOWN' })
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
			RETRY: {},
			START: {}
		}
	})

	return workflow.createMachine({
		id: 'application-readiness',
		initial: 'opening',
		context: {
			session: existing,
			status: 'transitioning',
			workspace: undefined,
			attachment: undefined,
			pending: undefined
		},
		invoke: {
			id: 'startup',
			src: 'startup',
			onError: [{ guard: 'shuttingDown' }, { target: '.settlingStartupFailure' }],
			onSnapshot: [
				{
					guard: not('acceptStartup')
				},
				{ guard: ({ event }) => event.snapshot.matches('error'), target: '.startupFailed' },
				{
					guard: ({ event }) => event.snapshot.context.result !== undefined,
					target: '.running',
					actions: assign({ session: ({ event }) => event.snapshot.context.result })
				},
				{ target: '.opening' }
			]
		},
		on: {
			'xstate.error.actor.*': [
				{
					guard: ({ context, event }) => context.workspace?.id === event.actorId,
					target: '.settlingObserverFailure',
					actions: [assign({ pending: undefined }), release]
				},
				{}
			],
			START: { actions: sendTo('startup', { type: 'START' }) },
			RETRY: { actions: sendTo('startup', { type: 'RETRY' }) },
			SHUTDOWN: { target: '.closing', actions: assign({ pending: undefined }) },
			ATTACH_WORKSPACE: [
				{
					guard: ({ context, event }) =>
						context.attachment === event.attachment || context.pending === event.attachment
				},
				{
					guard: ({ context }) => Boolean(context.workspace),
					actions: [
						assign({ pending: ({ event }) => event.attachment }),
						sendTo(({ context }) => required(context.workspace), { type: 'SHUTDOWN' })
					]
				},
				{ actions: [assign({ pending: ({ event }) => event.attachment }), attach] }
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
					actions: sendTo(({ context }) => required(context.workspace), { type: 'SHUTDOWN' })
				}
			],
			WORKSPACE_CLOSED: {
				guard: ({ context, event }) => context.workspace === event.actor,
				actions: release
			},
			ATTACH_PENDING: { guard: ({ context }) => Boolean(context.pending), actions: attach }
		},
		states: {
			opening: {},
			startupFailed: { tags: 'startup-error' },
			settlingStartupFailure: {
				entry: shutDownWorkspace,
				always: { guard: ({ context }) => !context.workspace, target: 'startupActorFailed' },
				on: { ATTACH_WORKSPACE: {}, ATTACH_PENDING: {}, RETRY: {}, START: {} }
			},
			startupActorFailed: {
				tags: 'startup-error',
				on: {
					RETRY: {
						target: '#application-readiness',
						reenter: true,
						actions: [assign({ session: undefined }), raise({ type: 'START' })]
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
				on: { RETRY: 'running', ATTACH_WORKSPACE: {}, ATTACH_PENDING: {} }
			},
			running: {
				initial: 'checking',
				invoke: {
					id: 'sessionObserver',
					src: 'observeSession',
					input: ({ context }) => required(context.session),
					onError: '#application-readiness.settlingObserverFailure'
				},
				on: {
					SESSION_OBSERVER_FAILED: '#application-readiness.settlingObserverFailure',
					SESSION_OBSERVED: {
						target: '.checking',
						actions: assign({ status: ({ event }) => event.status })
					},
					RETRY: '.retrying'
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
					retrying: {
						initial: 'active',
						invoke: {
							src: 'retrySession',
							input: ({ context }) => required(context.session),
							onDone: [
								{ guard: 'shuttingDown', target: '#application-readiness.closing' },
								{
									guard: 'retryStartupFailed',
									target: '#application-readiness.settlingStartupFailure'
								},
								{
									guard: 'retryObserverFailed',
									target: '#application-readiness.settlingObserverFailure'
								},
								{ target: 'checking' }
							],
							onError: [
								{ guard: 'shuttingDown', target: '#application-readiness.closing' },
								{
									guard: 'retryStartupFailed',
									target: '#application-readiness.settlingStartupFailure'
								},
								{
									guard: 'retryObserverFailed',
									target: '#application-readiness.settlingObserverFailure'
								},
								{ target: 'failed' }
							]
						},
						on: {
							START: {},
							RETRY: {},
							SESSION_OBSERVED: { actions: assign({ status: ({ event }) => event.status }) },
							SESSION_OBSERVER_FAILED: '.observerFailed',
							'xstate.error.actor.sessionObserver': '.observerFailed',
							'xstate.error.actor.startup': '.startupFailed',
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
									'xstate.error.actor.startup': {},
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
									'xstate.error.actor.startup': {},
									SHUTDOWN: {},
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
				always: { guard: ({ context }) => !context.workspace, target: 'closed' },
				entry: workflow.enqueueActions(({ context, enqueue }) => {
					if (context.workspace) enqueue.sendTo(context.workspace, { type: 'SHUTDOWN' })
				}),
				on: {
					'xstate.error.actor.*': [
						{
							guard: ({ context, event }) => context.workspace?.id === event.actorId,
							target: 'closed',
							actions: release
						},
						{}
					],
					WORKSPACE_CLOSED: {
						guard: ({ context, event }) => context.workspace === event.actor,
						target: 'closed',
						actions: [
							stopChild(({ context }) => required(context.workspace)),
							assign({ workspace: undefined, attachment: undefined })
						]
					},
					ATTACH_WORKSPACE: {},
					DETACH_WORKSPACE: {},
					ATTACH_PENDING: {},
					SHUTDOWN: {},
					START: {},
					RETRY: {}
				}
			},
			closed: {
				type: 'final',
				entry: assign({ workspace: undefined, attachment: undefined, pending: undefined })
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
