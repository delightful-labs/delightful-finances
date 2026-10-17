import { assign, fromPromise, raise, sendParent, sendTo, setup, stateIn } from 'xstate'
import { ensurePersonalWorkspace } from '#lib/data.js'
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
type Context = ReadinessObservation & { bootstrapUserId: string | undefined }
type Event =
	| { type: 'OBSERVED'; observation: ReadinessObservation }
	| { type: 'REEVALUATE' }
	| { type: 'BANK'; event: BankEvent }
	| { type: 'SHUTDOWN' }

export function createWorkspaceReadinessMachine({
	dependencies,
	read,
	selectOrganization
}: WorkspaceAttachment) {
	const actors = {
		bank: createBankSyncMachine(dependencies),
		select: fromPromise(async ({ input }: { input: string | null }) => selectOrganization(input)),
		bootstrap: fromPromise(({ input }: { input: string }) =>
			ensurePersonalWorkspace(dependencies.db, input)
		)
	}
	return setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{ canUseBank: undefined; workspaceReady: undefined }
	>({
		actors,
		guards: {
			canUseBank: stateIn({
				active: { workspace: 'ready', session: 'ready', organization: 'ready' }
			}),
			workspaceReady: stateIn({ active: { workspace: 'ready' } })
		}
	}).createMachine({
		id: 'workspace-readiness',
		initial: 'active',
		context: () => ({ ...read(), bootstrapUserId: undefined }),
		invoke: {
			id: 'bank',
			src: 'bank',
			onDone: [{ guard: stateIn('closing'), target: '.closed' }, { target: '.failed' }],
			onError: [{ guard: stateIn('closing'), target: '.closed' }, { target: '.failed' }]
		},
		on: {
			SHUTDOWN: { target: '.closing' },
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
					sendTo('bank', ({ event }) => ({ type: 'OBSERVED', source: event.observation.source })),
					raise({ type: 'REEVALUATE' })
				]
			}
		},
		states: {
			active: {
				type: 'parallel',
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
						initial: 'checkingIdentity',
						states: {
							checkingIdentity: {
								always: [
									{
										guard: ({ context }) => context.sessionStatus !== 'ready',
										target: 'waitingForSession'
									},
									{ guard: ({ context }) => !context.source.userId, target: 'waitingForSession' },
									{ target: 'initializing' }
								]
							},
							waitingForSession: { on: { REEVALUATE: 'checkingIdentity' } },
							initializing: {
								entry: assign({ bootstrapUserId: ({ context }) => context.source.userId }),
								invoke: {
									src: 'bootstrap',
									input: ({ context }) => required(context.bootstrapUserId),
									onDone: 'ready',
									onError: 'failed'
								},
								on: {
									REEVALUATE: [
										{
											guard: ({ context }) => context.sessionStatus !== 'ready',
											target: 'checkingIdentity'
										},
										{
											guard: ({ context }) => context.source.userId !== context.bootstrapUserId,
											target: 'checkingIdentity'
										}
									]
								}
							},
							ready: {
								tags: 'workspace-ready',
								entry: raise({ type: 'REEVALUATE' }),
								on: {
									REEVALUATE: [
										{
											guard: ({ context }) => context.sessionStatus !== 'ready',
											target: 'checkingIdentity'
										},
										{
											guard: ({ context }) => context.source.userId !== context.bootstrapUserId,
											target: 'checkingIdentity'
										}
									]
								}
							},
							failed: {
								tags: 'workspace-error',
								on: {
									REEVALUATE: {
										guard: ({ context }) => context.source.userId !== context.bootstrapUserId,
										target: 'checkingIdentity'
									}
								}
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
										guard: ({ context }) =>
											context.organizations?.some((row) => row.kind === 'personal') ?? false,
										target: 'selectingPersonal'
									},
									{
										guard: ({ context }) => (context.organizations?.length ?? 0) > 0,
										target: 'selectingFirst'
									},
									{ target: 'empty' }
								]
							},
							selectingPersonal: {
								invoke: {
									src: 'select',
									input: ({ context }) =>
										required(context.organizations?.find((row) => row.kind === 'personal')).id,
									onError: '#workspace-readiness.settlingFailure'
								}
							},
							selectingFirst: {
								invoke: {
									src: 'select',
									input: ({ context }) => required(context.organizations?.[0]).id,
									onError: '#workspace-readiness.settlingFailure'
								}
							},
							empty: {
								invoke: {
									src: 'select',
									input: null,
									onError: '#workspace-readiness.settlingFailure'
								}
							},
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
			settlingFailure: {
				entry: sendTo('bank', { type: 'SHUTDOWN' }),
				on: { BANK: {}, OBSERVED: {}, REEVALUATE: {} }
			},
			failed: {
				tags: 'workspace-error',
				on: { SHUTDOWN: 'closed', BANK: {}, OBSERVED: {}, REEVALUATE: {} }
			},
			closing: {
				entry: sendTo('bank', { type: 'SHUTDOWN' }),
				on: { BANK: {}, OBSERVED: {}, SHUTDOWN: {}, REEVALUATE: {} }
			},
			closed: {
				type: 'final',
				entry: sendParent(({ self }) => ({ type: 'WORKSPACE_CLOSED', actor: self }))
			}
		}
	})
}
