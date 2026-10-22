import { assign, raise, sendTo, setup, stateIn } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import {
	workspaceInitialization,
	type WorkspaceInitializationResult
} from './workspace-initialization.js'

type SessionFacts = {
	userId: string | undefined
	status: 'ready' | 'signed-out' | 'transitioning' | 'error' | 'closed'
}
type Event =
	| { type: 'OBSERVED'; source: SessionFacts }
	| { type: 'REEVALUATE' }
	| { type: 'RETRY' }
	| { type: 'SHUTDOWN' }
type Context = SessionFacts & {
	operationUserId: string | undefined
	result: WorkspaceInitializationResult | undefined
}
type Db = Pick<ReturnType<typeof getDb>, 'all' | 'beginTransaction' | 'getConfig'>

// Snapshot replacement is a workflow: keep the old initialization child alive until cleanup finishes.
export function createWorkspaceStartupMachine(db: Db) {
	return setup<
		Context,
		Event,
		{ initialize: typeof workspaceInitialization },
		{},
		{},
		{ closing: undefined; replacing: undefined; identityChanged: undefined },
		never,
		string,
		SessionFacts
	>({
		actors: { initialize: workspaceInitialization },
		guards: {
			closing: stateIn({ initializing: 'closing' }),
			replacing: stateIn({ initializing: 'replacing' }),
			identityChanged: ({ context }) =>
				context.status !== 'ready' || context.userId !== context.operationUserId
		}
	}).createMachine({
		id: 'workspace-startup',
		context: ({ input }) => ({ ...input, operationUserId: undefined, result: undefined }),
		initial: 'checking',
		on: {
			OBSERVED: { actions: [assign(({ event }) => event.source), raise({ type: 'REEVALUATE' })] },
			SHUTDOWN: '.closed'
		},
		states: {
			checking: {
				always: [
					{
						guard: ({ context }) => context.status === 'ready' && context.userId !== undefined,
						target: 'initializing'
					},
					{ target: 'waitingForSession' }
				]
			},
			waitingForSession: { on: { REEVALUATE: 'checking', RETRY: 'checking' } },
			initializing: {
				initial: 'active',
				entry: assign({ operationUserId: ({ context }) => context.userId, result: undefined }),
				on: {
					SHUTDOWN: { target: '.closing', actions: sendTo('initialize', { type: 'SHUTDOWN' }) },
					REEVALUATE: {
						guard: 'identityChanged',
						target: '.replacing',
						actions: sendTo('initialize', { type: 'SHUTDOWN' })
					},
					RETRY: {}
				},
				states: {
					active: {},
					replacing: { on: { REEVALUATE: {}, RETRY: {} } },
					closing: { on: { REEVALUATE: {}, RETRY: {}, SHUTDOWN: {} } }
				},
				invoke: {
					id: 'initialize',
					src: 'initialize',
					input: ({ context }) => {
						if (!context.operationUserId)
							throw new Error('Initialization requires a session identity')
						return { db, userId: context.operationUserId }
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
				on: { REEVALUATE: { guard: 'identityChanged', target: 'checking' } }
			},
			failed: {
				tags: 'workspace-error',
				on: { RETRY: 'checking', REEVALUATE: { guard: 'identityChanged', target: 'checking' } }
			},
			closed: { type: 'final', on: { OBSERVED: {}, SHUTDOWN: {} } }
		}
	})
}
