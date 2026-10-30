import { assign, raise, sendTo, setup, stateIn } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import {
	sameIntegrityRequest,
	type IntegrityRequest,
	type IntegrityStatus,
	type IntegrityRecipient,
	type IntegrityStatusEvent
} from '../../contracts/workspace-integrity-contract.js'
import type { IntegrityResult } from './workspace-integrity-transaction.js'
import { workspaceIntegrity } from './workspace-integrity.js'

export type {
	IntegrityBinding,
	WorkspaceIntegrityView
} from '../../contracts/workspace-integrity-contract.js'
type Input = { request: IntegrityRequest; recipient: IntegrityRecipient }
type Context = Input & {
	operation: IntegrityRequest | undefined
	result: IntegrityResult | undefined
}
type Event = { type: 'OBSERVED'; request: IntegrityRequest } | { type: 'REEVALUATE' | 'SHUTDOWN' }
type Db = Pick<ReturnType<typeof getDb>, 'all' | 'beginTransaction' | 'getConfig'>

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing integrity operation result')
	return value
}

/** The database binding is fixed; its parent drains this owner before replacing the database. */
export function createWorkspaceIntegrityOwner(db: Db) {
	const model = setup<
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
			bindingChanged: ({ context }) =>
				context.operation === undefined ||
				!sameIntegrityRequest(context.request, context.operation),
			closing: stateIn({ running: 'closing' }),
			replacing: stateIn({ running: 'replacing' })
		}
	})
	const report = (status: (context: Context) => IntegrityStatus) =>
		model.sendTo(
			({ context }) => context.recipient,
			({ context }): IntegrityStatusEvent => ({
				type: 'INTEGRITY_STATUS',
				report: { request: context.operation ?? context.request, status: status(context) }
			})
		)
	const settlement = (context: Context) => required(context.result).settlement
	return model.createMachine({
		id: 'workspace-integrity-owner',
		context: ({ input }) => ({ ...input, operation: undefined, result: undefined }),
		initial: 'checking',
		on: {
			OBSERVED: {
				actions: [assign({ request: ({ event }) => event.request }), raise({ type: 'REEVALUATE' })]
			},
			REEVALUATE: { guard: 'bindingChanged', target: '.checking' },
			SHUTDOWN: '.closed'
		},
		states: {
			checking: {
				always: [
					{ guard: ({ context }) => context.request.binding !== undefined, target: 'running' },
					{ target: 'waiting' }
				]
			},
			waiting: {
				tags: 'integrity-waiting',
				entry: [
					assign({ operation: undefined, result: undefined }),
					report(() => ({ kind: 'waiting' }))
				]
			},
			running: {
				tags: 'integrity-working',
				initial: 'active',
				entry: [
					assign({ operation: ({ context }) => context.request, result: undefined }),
					report(() => ({ kind: 'checking' }))
				],
				on: {
					REEVALUATE: {
						guard: 'bindingChanged',
						target: '.replacing',
						actions: sendTo('repair', { type: 'SHUTDOWN' })
					},
					SHUTDOWN: { target: '.closing', actions: sendTo('repair', { type: 'SHUTDOWN' }) }
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
					id: 'repair',
					src: 'repair',
					input: ({ context }) => {
						if (!context.operation?.binding)
							throw new Error('Integrity repair requires a bound workspace')
						return { ...context.operation.binding, db }
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
						{
							guard: 'closing',
							target: 'closed',
							actions: assign({
								result: ({ event }): IntegrityResult => ({
									outcome: 'failed',
									settlement: 'unresolved',
									error: event.error
								})
							})
						},
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
			complete: {
				tags: ['integrity-complete', 'integrity-finance-ready'],
				entry: report((context) => ({ kind: 'complete', settlement: settlement(context) }))
			},
			partial: {
				tags: ['integrity-partial', 'integrity-finance-ready'],
				entry: report((context) => {
					const result = required(context.result)
					if (result.outcome !== 'partial') throw new Error('Expected partial integrity result')
					return {
						kind: 'partial',
						issues: result.issues,
						settlement: result.settlement,
						access: 'usable'
					}
				})
			},
			unavailable: {
				tags: 'integrity-unavailable',
				entry: report((context) => ({ kind: 'unavailable', settlement: settlement(context) }))
			},
			conflict: {
				tags: 'integrity-conflict',
				entry: report((context) => ({ kind: 'conflict', settlement: settlement(context) }))
			},
			failed: {
				tags: 'integrity-failed',
				entry: report((context) => ({ kind: 'failed', settlement: settlement(context) }))
			},
			unresolved: {
				tags: 'integrity-unresolved',
				entry: report(() => ({ kind: 'unresolved', settlement: 'unresolved' }))
			},
			closed: {
				type: 'final',
				entry: report((context) => ({
					kind: 'closed',
					settlement: context.result?.settlement ?? 'notStarted'
				})),
				on: { OBSERVED: {}, REEVALUATE: {}, SHUTDOWN: {} }
			}
		}
	})
}
