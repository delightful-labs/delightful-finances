import { assign, raise, sendTo, setup, stateIn } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import type { OrganizationMember } from '../schema.js'
import type { IntegrityScope } from './workspace-integrity-assessment.js'
import type { IntegrityResult } from './workspace-integrity-transaction.js'
import { workspaceIntegrity } from './workspace-integrity.js'

export type IntegrityBinding = IntegrityScope & {
	membershipId: string
	role: OrganizationMember['role']
	accountAccessMode: OrganizationMember['accountAccessMode']
}
type Input = { binding: IntegrityBinding | undefined }
type Context = Input & {
	operation: IntegrityBinding | undefined
	result: IntegrityResult | undefined
}
type Event =
	| { type: 'OBSERVED'; binding: IntegrityBinding | undefined }
	| { type: 'REEVALUATE' | 'RETRY' | 'SHUTDOWN' }
type Db = Pick<ReturnType<typeof getDb>, 'all' | 'beginTransaction' | 'getConfig'>

/** Binding equality, not a permission decision. Profile-link repair does not change authority. */
function sameBinding(left: IntegrityBinding | undefined, right: IntegrityBinding | undefined) {
	return (
		left?.userId === right?.userId &&
		left?.organizationId === right?.organizationId &&
		left?.profileId === right?.profileId &&
		left?.membershipId === right?.membershipId &&
		left?.role === right?.role &&
		left?.accountAccessMode === right?.accountAccessMode
	)
}

/** The database binding is fixed; its parent drains this owner before replacing the database. */
export function createWorkspaceIntegrityOwner(db: Db) {
	return setup<
		Context,
		Event,
		{ repair: typeof workspaceIntegrity },
		{},
		{},
		{ bindingChanged: undefined; closing: undefined; replacing: undefined },
		never,
		string,
		Input
	>({
		actors: { repair: workspaceIntegrity },
		guards: {
			bindingChanged: ({ context }) => !sameBinding(context.binding, context.operation),
			closing: stateIn({ running: 'closing' }),
			replacing: stateIn({ running: 'replacing' })
		}
	}).createMachine({
		id: 'workspace-integrity-owner',
		context: ({ input }) => ({ ...input, operation: undefined, result: undefined }),
		initial: 'checking',
		on: {
			OBSERVED: {
				actions: [assign({ binding: ({ event }) => event.binding }), raise({ type: 'REEVALUATE' })]
			},
			REEVALUATE: { guard: 'bindingChanged', target: '.checking' },
			RETRY: '.checking',
			SHUTDOWN: '.closed'
		},
		states: {
			checking: {
				always: [
					{ guard: ({ context }) => context.binding !== undefined, target: 'running' },
					{ target: 'waiting' }
				]
			},
			waiting: {
				tags: 'integrity-waiting',
				entry: assign({ operation: undefined, result: undefined })
			},
			running: {
				tags: 'integrity-working',
				initial: 'active',
				entry: assign({ operation: ({ context }) => context.binding, result: undefined }),
				on: {
					REEVALUATE: {
						guard: 'bindingChanged',
						target: '.replacing',
						actions: sendTo('repair', { type: 'SHUTDOWN' })
					},
					SHUTDOWN: { target: '.closing', actions: sendTo('repair', { type: 'SHUTDOWN' }) },
					RETRY: {}
				},
				states: {
					active: {},
					replacing: { on: { REEVALUATE: {}, RETRY: {} } },
					closing: { on: { REEVALUATE: {}, RETRY: {}, SHUTDOWN: {} } }
				},
				invoke: {
					id: 'repair',
					src: 'repair',
					input: ({ context }) => {
						if (!context.operation) throw new Error('Integrity repair requires a bound workspace')
						return { ...context.operation, db }
					},
					onDone: [
						{
							guard: 'closing',
							target: 'closed',
							actions: assign({ result: ({ event }) => event.output })
						},
						{ guard: 'replacing', target: 'checking' },
						{ target: 'classifying', actions: assign({ result: ({ event }) => event.output }) }
					],
					onError: [
						{ guard: 'closing', target: 'closed' },
						{ guard: 'replacing', target: 'checking' },
						{
							target: 'unresolved',
							actions: assign({
								result: ({ event }): IntegrityResult => ({
									outcome: 'failed',
									settlement: 'unresolved',
									error: event.error
								})
							})
						}
					]
				}
			},
			classifying: {
				always: [
					{ guard: ({ context }) => context.result?.outcome === 'complete', target: 'complete' },
					{ guard: ({ context }) => context.result?.outcome === 'partial', target: 'partial' },
					{
						guard: ({ context }) => context.result?.outcome === 'unavailable',
						target: 'unavailable'
					},
					{ guard: ({ context }) => context.result?.outcome === 'conflict', target: 'conflict' },
					{
						guard: ({ context }) => context.result?.settlement === 'unresolved',
						target: 'unresolved'
					},
					{ target: 'failed' }
				]
			},
			complete: { tags: 'integrity-complete' },
			partial: { tags: 'integrity-partial' },
			unavailable: { tags: 'integrity-unavailable' },
			conflict: { tags: 'integrity-conflict' },
			failed: { tags: 'integrity-failed' },
			unresolved: { tags: 'integrity-unresolved' },
			closed: { type: 'final', on: { OBSERVED: {}, REEVALUATE: {}, RETRY: {}, SHUTDOWN: {} } }
		}
	})
}
