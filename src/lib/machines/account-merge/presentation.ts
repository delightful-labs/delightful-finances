import { assign, setup, type SnapshotFrom } from 'xstate'
import type {
	MergeDestination,
	MergeDestinationError,
	MergeDestinationResult
} from '#lib/schema/account-merge-destination.js'
import { required } from '../bank-sync/identity.js'

type Observation = {
	status: 'ready' | 'signed-out' | 'transitioning' | 'error' | 'closed'
	identityId: string | null
	organizationId: string | null
	binding: object | null
}
type Context = {
	observation: Observation | undefined
	request: MergeDestination | undefined
	result: MergeDestinationResult | undefined
}
type Event =
	| { type: 'OBSERVED'; observation: Observation }
	| { type: 'CHECK' | 'CANCEL' | 'SHUTDOWN' }
	| { type: 'RESULT'; request: MergeDestination; result: MergeDestinationResult }
export type AccountMergePresentation =
	| {
			kind:
				'waiting' | 'session-unavailable' | 'select-workspace' | 'available' | 'eligible' | 'closed'
	  }
	| { kind: 'checking'; request: MergeDestination }
	| { kind: 'denied'; code: MergeDestinationError }

// Read-only route presentation. Import/identity replacement remains unavailable
// until the source-capture and coordinator contracts can be fulfilled.
export function createAccountMergePresentationMachine(binding: object) {
	const workflow = setup<Context, Event>({})
	const clear = workflow.assign({ request: undefined, result: undefined })
	const checkable = workflow.createStateConfig({
		on: {
			CHECK: {
				target: 'checking',
				actions: workflow.assign({
					request: ({ context }) => ({
						identityId: required(required(context.observation).identityId),
						organizationId: required(required(context.observation).organizationId)
					}),
					result: undefined
				})
			}
		}
	})
	return workflow.createMachine({
		id: 'account-merge-presentation',
		initial: 'assessing',
		context: { observation: undefined, request: undefined, result: undefined },
		on: {
			OBSERVED: [
				{
					guard: ({ context, event }) =>
						context.observation?.status === event.observation.status &&
						context.observation.identityId === event.observation.identityId &&
						context.observation.organizationId === event.observation.organizationId &&
						context.observation.binding === event.observation.binding,
					actions: assign({ observation: ({ event }) => event.observation })
				},
				{
					target: '.assessing',
					actions: [assign({ observation: ({ event }) => event.observation }), clear]
				}
			],
			CANCEL: { target: '.assessing', actions: clear },
			SHUTDOWN: '.closed'
		},
		states: {
			assessing: {
				always: [
					{ guard: ({ context }) => !context.observation, target: 'waiting' },
					{
						guard: ({ context }) => required(context.observation).status !== 'ready',
						target: 'sessionUnavailable'
					},
					{
						guard: ({ context }) => required(context.observation).identityId === null,
						target: 'sessionUnavailable'
					},
					{
						guard: ({ context }) => required(context.observation).binding !== binding,
						target: 'sessionUnavailable'
					},
					{
						guard: ({ context }) => required(context.observation).organizationId === null,
						target: 'selectWorkspace'
					},
					{ target: 'available' }
				]
			},
			waiting: {},
			sessionUnavailable: {},
			selectWorkspace: {},
			available: checkable,
			eligible: checkable,
			denied: checkable,
			checking: {
				on: {
					RESULT: [
						{
							guard: ({ context, event }) =>
								event.request === context.request && event.result.outcome === 'eligible',
							target: 'eligible',
							actions: [
								assign({ result: ({ event }) => event.result }),
								workflow.assign({ request: undefined })
							]
						},
						{
							guard: ({ context, event }) =>
								event.request === context.request && event.result.outcome === 'failed',
							target: 'denied',
							actions: [
								assign({ result: ({ event }) => event.result }),
								workflow.assign({ request: undefined })
							]
						},
						{
							guard: ({ context, event }) => event.request === context.request,
							target: 'assessing',
							actions: clear
						}
					]
				}
			},
			closed: { type: 'final', entry: [clear, workflow.assign({ observation: undefined })] }
		}
	})
}
export function selectAccountMergePresentation(
	snapshot: SnapshotFrom<ReturnType<typeof createAccountMergePresentationMachine>>
): AccountMergePresentation {
	if (snapshot.matches('checking'))
		return { kind: 'checking', request: required(snapshot.context.request) }
	if (snapshot.matches('denied')) {
		const result = required(snapshot.context.result)
		if (result.outcome !== 'failed') throw new Error('Expected destination failure')
		return { kind: 'denied', code: result.code }
	}
	if (snapshot.matches('eligible')) return { kind: 'eligible' }
	if (snapshot.matches('available')) return { kind: 'available' }
	if (snapshot.matches('sessionUnavailable')) return { kind: 'session-unavailable' }
	if (snapshot.matches('selectWorkspace')) return { kind: 'select-workspace' }
	return { kind: snapshot.matches('closed') ? 'closed' : 'waiting' }
}
