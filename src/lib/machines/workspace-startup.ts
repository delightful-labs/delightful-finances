import { assign, raise, sendTo, setup, stateIn } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import {
	workspaceInitialization,
	type WorkspaceInitializationResult
} from './workspace-initialization.js'

import {
	sameInitializationRequest,
	type InitializationRequest,
	type InitializationRecipient,
	type InitializationStatus,
	type InitializationStatusEvent
} from '../workspace-orchestration-contract.js'

type Input = { request: InitializationRequest; recipient: InitializationRecipient }
type Event =
	{ type: 'OBSERVED'; request: InitializationRequest } | { type: 'REEVALUATE' | 'SHUTDOWN' }
type Context = Input & {
	operation: InitializationRequest | undefined
	result: WorkspaceInitializationResult | undefined
}
type Db = Pick<
	ReturnType<typeof getDb>,
	'all' | 'beginTransaction' | 'beginExclusiveTransaction' | 'getConfig'
>

// Snapshot replacement is a workflow: keep the old initialization child alive until cleanup finishes.
export function createWorkspaceStartupMachine(db: Db) {
	const model = setup<
		Context,
		Event,
		{ initialize: typeof workspaceInitialization },
		{},
		{},
		{ closing: undefined; replacing: undefined; identityChanged: undefined },
		never,
		string,
		Input
	>({
		actors: { initialize: workspaceInitialization },
		guards: {
			closing: stateIn({ initializing: 'closing' }),
			replacing: stateIn({ initializing: 'replacing' }),
			identityChanged: ({ context }) =>
				context.operation === undefined ||
				!sameInitializationRequest(context.request, context.operation)
		}
	})
	const report = (status: (context: Context) => InitializationStatus) =>
		model.sendTo(
			({ context }) => context.recipient,
			({ context }): InitializationStatusEvent => ({
				type: 'INITIALIZATION_STATUS',
				report: { request: context.operation ?? context.request, status: status(context) }
			})
		)
	return model.createMachine({
		id: 'workspace-startup',
		context: ({ input }) => ({ ...input, operation: undefined, result: undefined }),
		initial: 'checking',
		on: {
			OBSERVED: {
				actions: [assign({ request: ({ event }) => event.request }), raise({ type: 'REEVALUATE' })]
			},
			SHUTDOWN: '.closed'
		},
		states: {
			checking: {
				always: [
					{
						guard: ({ context }) =>
							context.request.status === 'ready' && context.request.userId !== undefined,
						target: 'initializing'
					},
					{ target: 'waitingForSession' }
				]
			},
			waitingForSession: {
				entry: [assign({ operation: undefined }), report(() => ({ kind: 'waiting' }))],
				on: { REEVALUATE: 'checking' }
			},
			initializing: {
				initial: 'active',
				entry: [
					assign({ operation: ({ context }) => context.request, result: undefined }),
					report(() => ({ kind: 'checking' }))
				],
				on: {
					SHUTDOWN: { target: '.closing', actions: sendTo('initialize', { type: 'SHUTDOWN' }) },
					REEVALUATE: {
						guard: 'identityChanged',
						target: '.replacing',
						actions: sendTo('initialize', { type: 'SHUTDOWN' })
					}
				},
				states: {
					active: {},
					replacing: { entry: report(() => ({ kind: 'waiting' })), on: { REEVALUATE: {} } },
					closing: {
						entry: report(() => ({ kind: 'waiting' })),
						on: { REEVALUATE: {}, SHUTDOWN: {} }
					}
				},
				invoke: {
					id: 'initialize',
					src: 'initialize',
					input: ({ context }) => {
						if (!context.operation?.userId)
							throw new Error('Initialization requires a session identity')
						return { db, userId: context.operation.userId }
					},
					onDone: [
						{ guard: 'closing', target: 'closed' },
						{ guard: 'replacing', target: 'checking' },
						{
							guard: ({ event }) => event.output.outcome === 'ready',
							target: 'ready',
							actions: assign({ result: ({ event }) => event.output })
						},
						{ target: 'failed', actions: assign({ result: ({ event }) => event.output }) }
					],
					onError: [
						{ guard: 'closing', target: 'closed' },
						{ guard: 'replacing', target: 'checking' },
						{
							target: 'failed',
							actions: assign({
								result: ({ event }): WorkspaceInitializationResult => ({
									outcome: 'failed',
									settlement: 'unresolved',
									error: event.error
								})
							})
						}
					]
				}
			},
			ready: {
				tags: 'workspace-ready',
				entry: report((context) => {
					if (context.result?.outcome !== 'ready') throw new Error('Expected initialized profile')
					return { kind: 'ready', profileId: context.result.profileId }
				}),
				on: { REEVALUATE: { guard: 'identityChanged', target: 'checking' } }
			},
			failed: {
				tags: 'workspace-error',
				entry: report(() => ({ kind: 'failed' })),
				on: { REEVALUATE: { guard: 'identityChanged', target: 'checking' } }
			},
			closed: {
				type: 'final',
				entry: report(() => ({ kind: 'closed' })),
				on: { OBSERVED: {}, SHUTDOWN: {} }
			}
		}
	})
}
