import { assign, sendTo, setup, stateIn } from 'xstate'
import {
	createSyncLogRetentionMachine,
	type RetentionScope,
	type RetentionResult
} from './log-retention.js'
import { required } from './identity.js'
import type { Dependencies } from './types.js'
import {
	retainResourceRelease,
	type WorkspaceResourceRelease
} from '../../contracts/workspace-resource-release.js'

type Event =
	| { type: 'CHECK'; scope: RetentionScope | undefined; completion: string | undefined }
	| { type: 'SHUTDOWN' }
type Context = {
	release: WorkspaceResourceRelease
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

function retentionRelease(result: RetentionResult): WorkspaceResourceRelease {
	if (result.settlement === 'unresolved') return { outcome: 'unresolved' }
	return { outcome: result.kind === 'failed' ? 'releasedWithFailure' : 'released' }
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
		string,
		unknown,
		WorkspaceResourceRelease
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
		context: {
			scope: undefined,
			completion: undefined,
			result: undefined,
			release: { outcome: 'released' }
		},
		output: ({ context }) => context.release,
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
						{
							guard: 'closing',
							target: 'closed',
							actions: assign(({ context, event }) => ({
								result: event.output,
								release: retainResourceRelease(context.release, retentionRelease(event.output))
							}))
						},
						{
							guard: 'replacing',
							target: 'choosing',
							actions: assign(({ context, event }) => ({
								result: event.output,
								release: retainResourceRelease(context.release, retentionRelease(event.output))
							}))
						},
						{
							target: 'idle',
							actions: assign(({ context, event }) => ({
								result: event.output,
								release: retainResourceRelease(context.release, retentionRelease(event.output))
							}))
						}
					],
					onError: [
						{
							guard: 'closing',
							target: 'closed',
							actions: assign({ release: { outcome: 'unresolved' } })
						},
						{
							guard: 'replacing',
							target: 'choosing',
							actions: assign({ release: { outcome: 'unresolved' } })
						},
						{
							target: 'idle',
							actions: assign({
								result: { kind: 'failed', deletedCount: 0, settlement: 'unresolved' },
								release: { outcome: 'unresolved' }
							})
						}
					]
				}
			},
			closed: { type: 'final', entry: assign({ scope: undefined, completion: undefined }) }
		}
	})
}
