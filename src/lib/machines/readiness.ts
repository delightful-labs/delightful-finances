import {
	assign,
	fromPromise,
	raise,
	sendParent,
	sendTo,
	setup,
	stateIn,
	type ActorRefFrom
} from 'xstate'
import { createWorkspaceStartupMachine } from './workspace-startup.js'
import type { Organization } from '#lib/schema.js'
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
}
export type WorkspaceAttachment = {
	dependencies: BankSyncDependencies
	read: () => ReadinessObservation
	selectOrganization: (id: string | null) => void
}
type Context = ReadinessObservation & {
	bankActor: ActorRefFrom<ReturnType<typeof createBankSyncMachine>> | undefined
	startupActor: ActorRefFrom<ReturnType<typeof createWorkspaceStartupMachine>> | undefined
}
type Event =
	| { type: 'OBSERVED'; observation: ReadinessObservation }
	| { type: 'REEVALUATE' }
	| { type: 'BANK'; event: BankEvent }
	| { type: 'SHUTDOWN' }
	| { type: 'RETRY' }
	| { type: 'INITIALIZATION_READY' }
	| { type: 'INITIALIZATION_WAITING' }
	| { type: 'INITIALIZATION_FAILED' }
	| { type: 'STARTUP_STOPPED' }
	| { type: 'BANK_STOPPED' }

export function createWorkspaceReadinessMachine({
	dependencies,
	read,
	selectOrganization
}: WorkspaceAttachment) {
	const actors = {
		bank: createBankSyncMachine(dependencies),
		select: fromPromise(async ({ input }: { input: string | null }) => selectOrganization(input)),
		startup: createWorkspaceStartupMachine(dependencies.db)
	}
	return setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{
			canUseBank: undefined
			workspaceReady: undefined
			closingDrain: undefined
			bankAlive: undefined
			startupAlive: undefined
		}
	>({
		actors,
		guards: {
			canUseBank: stateIn({
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
			startupAlive: ({ context }) => context.startupActor?.getSnapshot().status === 'active'
		}
	}).createMachine({
		id: 'workspace-readiness',
		initial: 'active',
		context: () => ({ ...read(), bankActor: undefined, startupActor: undefined }),
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
				input: ({ context }) => ({ userId: context.source.userId, status: context.sessionStatus }),
				onSnapshot: [
					{
						guard: ({ event }) => event.snapshot.hasTag('workspace-ready'),
						actions: raise({ type: 'INITIALIZATION_READY' })
					},
					{
						guard: ({ event }) => event.snapshot.hasTag('workspace-error'),
						actions: raise({ type: 'INITIALIZATION_FAILED' })
					},
					{ actions: raise({ type: 'INITIALIZATION_WAITING' }) }
				],
				onDone: { actions: raise({ type: 'STARTUP_STOPPED' }) },
				onError: { actions: raise({ type: 'STARTUP_STOPPED' }) }
			}
		],
		on: {
			SHUTDOWN: { target: '.closing.intent.shutdown' },
			RETRY: { actions: sendTo('startup', { type: 'RETRY' }) },
			BANK: [
				{
					guard: ({ event }) => event.event.type === 'CANCEL' || event.event.type === 'RESET',
					actions: sendTo('bank', ({ event }) => event.event)
				},
				{ guard: 'canUseBank', actions: sendTo('bank', ({ event }) => event.event) }
			],
			OBSERVED: {
				actions: [
					assign(({ event }) => event.observation),
					sendTo('startup', ({ event }) => ({
						type: 'OBSERVED',
						source: {
							userId: event.observation.source.userId,
							status: event.observation.sessionStatus
						}
					})),
					sendTo('bank', ({ event }) => ({ type: 'OBSERVED', source: event.observation.source })),
					raise({ type: 'REEVALUATE' })
				]
			}
		},
		states: {
			active: {
				type: 'parallel',
				on: {
					BANK_STOPPED: '#workspace-readiness.closing.intent.failed',
					STARTUP_STOPPED: '#workspace-readiness.closing.intent.failed'
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
							INITIALIZATION_READY: '.ready',
							INITIALIZATION_WAITING: '.waiting',
							INITIALIZATION_FAILED: '.failed'
						},
						states: {
							waiting: {},
							ready: { tags: 'workspace-ready', entry: raise({ type: 'REEVALUATE' }) },
							failed: { tags: ['workspace-error', 'workspace-retryable'] }
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
									{
										guard: ({ context }) => context.organizations?.length === 1,
										target: 'selectingOnly'
									},
									{ target: 'unselected' }
								]
							},
							selectingOnly: {
								invoke: {
									src: 'select',
									input: ({ context }) => required(context.organizations?.[0]).id,
									onError: '#workspace-readiness.closing.intent.failed'
								}
							},
							unselected: {
								invoke: {
									src: 'select',
									input: null,
									onError: '#workspace-readiness.closing.intent.failed'
								}
							},
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
					bankActor: ({ self }) => self.getSnapshot().children.bank,
					startupActor: ({ self }) => self.getSnapshot().children.startup
				}),
				on: {
					BANK: {},
					OBSERVED: {},
					REEVALUATE: {},
					RETRY: {},
					INITIALIZATION_READY: {},
					INITIALIZATION_FAILED: {},
					INITIALIZATION_WAITING: {},
					SHUTDOWN: '.intent.shutdown'
				},
				states: {
					intent: {
						initial: 'failed',
						states: { failed: { type: 'final' }, shutdown: { type: 'final' } }
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
				on: { SHUTDOWN: 'closed', BANK: {}, OBSERVED: {}, REEVALUATE: {}, RETRY: {} }
			},
			closed: {
				type: 'final',
				entry: sendParent(({ self }) => ({ type: 'WORKSPACE_CLOSED', actor: self }))
			}
		}
	})
}
