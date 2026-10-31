import { assign, sendTo, setup, stateIn } from 'xstate'
import {
	createSyncLogRetentionMachine,
	type RetentionScope,
	type RetentionResult
} from './log-retention.js'
import { required } from './identity.js'
import type { Dependencies } from './types.js'

type Event =
	| { type: 'CHECK'; scope: RetentionScope | undefined; completion: string | undefined }
	| { type: 'SHUTDOWN' }
type Context = {
	scope: RetentionScope | undefined
	completion: string | undefined
	result: RetentionResult | undefined
}
function sameScope(left: RetentionScope | undefined, right: RetentionScope | undefined) {
	return (
		left?.connectionId === right?.connectionId &&
		left?.organizationId === right?.organizationId &&
		left?.userId === right?.userId
	)
}

/** Rebind only after the previous transaction owner has drained. */
export function createSyncLogRetentionCoordinator(
	dependencies: Pick<Dependencies, 'db' | 'observe'>
) {
	const actors = { retention: createSyncLogRetentionMachine(dependencies) }
	return setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{ closing: undefined; replacing: undefined; hasScope: undefined },
		never,
		string
	>({
		actors,
		guards: {
			closing: stateIn({ working: 'closing' }),
			replacing: stateIn({ working: 'replacing' }),
			hasScope: ({ context }) => context.scope !== undefined
		},
		delays: { retry: 60_000 }
	}).createMachine({
		id: 'sync-log-retention-coordinator',
		context: { scope: undefined, completion: undefined, result: undefined },
		initial: 'idle',
		states: {
			idle: {
				on: {
					CHECK: {
						guard: ({ context, event }) =>
							context.result === undefined ||
							!sameScope(context.scope, event.scope) ||
							context.completion !== event.completion,
						target: 'choosing',
						actions: assign(({ event }) => ({ scope: event.scope, completion: event.completion }))
					},
					SHUTDOWN: 'closed'
				},
				after: { retry: { guard: 'hasScope', target: 'working' } }
			},
			choosing: {
				always: [{ guard: 'hasScope', target: 'working' }, { target: 'idle' }]
			},
			working: {
				initial: 'active',
				states: { active: {}, replacing: {}, closing: { on: { CHECK: {}, SHUTDOWN: {} } } },
				on: {
					CHECK: {
						guard: ({ context, event }) =>
							!sameScope(context.scope, event.scope) || context.completion !== event.completion,
						target: '.replacing',
						actions: [
							assign(({ event }) => ({ scope: event.scope, completion: event.completion })),
							sendTo('retention', { type: 'CANCEL' })
						]
					},
					SHUTDOWN: { target: '.closing', actions: sendTo('retention', { type: 'CANCEL' }) }
				},
				invoke: {
					id: 'retention',
					src: 'retention',
					input: ({ context }) => ({ scope: required(context.scope) }),
					onDone: [
						{ guard: 'closing', target: 'closed' },
						{
							guard: 'replacing',
							target: 'choosing',
							actions: assign({ result: ({ event }) => event.output })
						},
						{ target: 'idle', actions: assign({ result: ({ event }) => event.output }) }
					],
					onError: [
						{ guard: 'closing', target: 'closed' },
						{ guard: 'replacing', target: 'choosing' },
						{
							target: 'idle',
							actions: assign({
								result: { kind: 'failed', deletedCount: 0, settlement: 'unresolved' }
							})
						}
					]
				}
			},
			closed: { type: 'final', entry: assign({ scope: undefined, completion: undefined }) }
		}
	})
}
