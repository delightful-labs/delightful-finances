import { assign, fromCallback, fromPromise, setup, stateIn, raise, type SnapshotFrom } from 'xstate'
import type { AccountMergeSnapshot } from '#lib/schema/account-merge.js'
import type { AccountMergeJournal, MergeJournalCommand } from '#lib/schema/account-merge-journal.js'
import type { MergeCaptureDependencies } from '#lib/schema/account-merge-capture.js'
import type {
	MergeDestination,
	MergeDestinationSession
} from '#lib/schema/account-merge-destination.js'
import type { MergeJournalStorage } from '#lib/account-merge/journal.js'
import { createAccountMergeCaptureMachine } from './capture.js'
import { createMergeJournalMachine } from './journal.js'
import { required } from '../bank-sync/identity.js'

type Problem = 'capture' | 'invalid-source' | 'storage' | 'conflict'
type Context = {
	observation: MergeDestinationSession | undefined
	source: MergeDestination | undefined
	snapshot: AccountMergeSnapshot | undefined
	journal: AccountMergeJournal | null
	command: MergeJournalCommand
	problem: Problem | undefined
}
type Event =
	| { type: 'OBSERVED'; observation: MergeDestinationSession }
	| { type: 'CAPTURE' | 'SAVE' | 'DISCARD' | 'RETRY' | 'CANCEL' | 'SHUTDOWN' | 'SESSION_FAILED' }
export type AccountMergeView =
	| { kind: 'review' | 'saved'; snapshot: AccountMergeSnapshot }
	| { kind: 'failed'; problem: Problem }
	| { kind: 'available' | 'unavailable' | 'working' | 'capturing' | 'closed' }

// Route-owned source-copy phase. Session replacement/import will require moving
// this owner outside the identity-bound subtree before those effects are enabled.
export function createAccountMergeMachine(
	dependencies: MergeCaptureDependencies,
	storage: MergeJournalStorage
) {
	const actors = {
		capture: createAccountMergeCaptureMachine(dependencies),
		journal: createMergeJournalMachine(storage),
		observe: fromCallback<Event>(({ sendBack }) =>
			dependencies.session({
				next: (observation) => sendBack({ type: 'OBSERVED', observation }),
				error: () => sendBack({ type: 'SESSION_FAILED' })
			})
		),
		envelope: fromPromise<AccountMergeJournal, AccountMergeSnapshot>(({ input }) =>
			Promise.resolve({
				version: 1,
				operationId: crypto.randomUUID(),
				snapshot: input,
				destination: null
			})
		)
	}
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{ closingJournal: undefined; cancellingJournal: undefined }
	>({
		actors,
		guards: {
			closingJournal: stateIn('#account-merge.accessingJournal.closing'),
			cancellingJournal: stateIn('#account-merge.accessingJournal.cancelling')
		}
	})
	const observe = workflow.assign({
		observation: ({ context, event }) =>
			event.type === 'OBSERVED' ? event.observation : context.observation
	})
	const clearCopy = workflow.assign({
		source: undefined,
		snapshot: undefined,
		problem: undefined,
		command: { type: 'LOAD' }
	})
	const assess = workflow.createStateConfig({
		on: { OBSERVED: { target: 'assessing', actions: observe } }
	})
	const abortJournal = workflow.sendTo('journal', { type: 'CANCEL' })
	const closeJournal = workflow.sendTo('journal', { type: 'SHUTDOWN' })
	return workflow.createMachine({
		id: 'account-merge',
		initial: 'accessingJournal',
		context: {
			observation: undefined,
			source: undefined,
			snapshot: undefined,
			journal: null,
			command: { type: 'LOAD' },
			problem: undefined
		},
		invoke: { src: 'observe', onError: { actions: raise({ type: 'SESSION_FAILED' }) } },
		on: {
			OBSERVED: { actions: observe },
			SESSION_FAILED: { actions: assign({ observation: undefined }) },
			CANCEL: { target: '.assessing', actions: clearCopy },
			SHUTDOWN: '.closed'
		},
		states: {
			assessing: {
				entry: clearCopy,
				always: [
					{ guard: ({ context }) => context.journal !== null, target: 'saved' },
					{
						guard: ({ context }) =>
							context.observation?.ready === true &&
							context.observation.identityId !== null &&
							context.observation.organizationId !== null &&
							context.observation.binding === dependencies.binding,
						target: 'available'
					},
					{ target: 'unavailable' }
				]
			},
			available: {
				...assess,
				on: {
					...assess.on,
					CAPTURE: {
						target: 'capturing',
						actions: assign({
							source: ({ context }) => ({
								identityId: required(required(context.observation).identityId),
								organizationId: required(required(context.observation).organizationId)
							})
						})
					},
					SESSION_FAILED: { target: 'unavailable', actions: assign({ observation: undefined }) }
				}
			},
			unavailable: {
				...assess,
				on: { ...assess.on, RETRY: { target: '#account-merge', reenter: true, actions: clearCopy } }
			},
			capturing: {
				invoke: {
					src: 'capture',
					input: ({ context }: { context: Context }) => required(context.source),
					onDone: [
						{
							guard: ({ event }) => event.output.outcome === 'captured',
							target: 'review',
							actions: assign({
								snapshot: ({ event }) =>
									event.output.outcome === 'captured' ? event.output.snapshot : undefined
							})
						},
						{
							guard: ({ event }) =>
								event.output.outcome === 'cancelled' || event.output.outcome === 'closed',
							target: 'assessing'
						},
						{
							target: 'failed',
							actions: assign({
								problem: ({ event }) =>
									event.output.outcome === 'invalid' ? 'invalid-source' : 'capture'
							})
						}
					],
					onError: { target: 'failed', actions: assign({ problem: 'capture' }) }
				}
			},
			review: { on: { SAVE: 'preparingJournal' } },
			preparingJournal: {
				invoke: {
					src: 'envelope',
					input: ({ context }) => required(context.snapshot),
					onDone: {
						target: 'accessingJournal',
						actions: assign({ command: ({ event }) => ({ type: 'CREATE', journal: event.output }) })
					},
					onError: { target: 'failed', actions: assign({ problem: 'storage' }) }
				}
			},
			accessingJournal: {
				initial: 'working',
				invoke: {
					id: 'journal',
					src: 'journal',
					input: ({ context }) => ({ command: context.command }),
					onDone: [
						{ guard: 'closingJournal', target: 'closed' },
						{
							guard: ({ event }) =>
								event.output.outcome === 'completed' || event.output.outcome === 'partial',
							target: 'assessing',
							actions: assign({
								journal: ({ event }) => ('journal' in event.output ? event.output.journal : null),
								command: { type: 'LOAD' }
							})
						},
						{ guard: 'cancellingJournal', target: 'assessing' },
						{
							target: 'failed',
							actions: assign({
								problem: ({ event }) =>
									event.output.outcome === 'conflict' ? 'conflict' : 'storage',
								command: { type: 'LOAD' }
							})
						}
					],
					onError: [
						{ guard: 'closingJournal', target: 'closed' },
						{ guard: 'cancellingJournal', target: 'assessing' },
						{ target: 'failed', actions: assign({ problem: 'storage', command: { type: 'LOAD' } }) }
					]
				},
				on: {
					CANCEL: { target: '.cancelling', actions: abortJournal },
					SHUTDOWN: { target: '.closing', actions: closeJournal }
				},
				states: {
					working: {},
					cancelling: {
						on: { CANCEL: {}, SHUTDOWN: { target: 'closing', actions: closeJournal } }
					},
					closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
				}
			},
			saved: {
				on: {
					CANCEL: {},
					DISCARD: {
						target: 'accessingJournal',
						actions: assign({
							command: ({ context }) => ({
								type: 'DISCARD',
								operationId: required(context.journal).operationId
							})
						})
					}
				}
			},
			failed: {
				entry: assign({ snapshot: undefined, source: undefined }),
				on: {
					RETRY: {
						target: 'accessingJournal',
						actions: assign({ command: { type: 'LOAD' }, problem: undefined })
					}
				}
			},
			closed: {
				type: 'final',
				entry: assign({
					observation: undefined,
					source: undefined,
					snapshot: undefined,
					journal: null,
					command: { type: 'LOAD' },
					problem: undefined
				})
			}
		}
	})
}
export function selectAccountMergeView(
	snapshot: SnapshotFrom<ReturnType<typeof createAccountMergeMachine>>
): AccountMergeView {
	if (snapshot.matches('review'))
		return { kind: 'review', snapshot: required(snapshot.context.snapshot) }
	if (snapshot.matches('saved'))
		return { kind: 'saved', snapshot: required(snapshot.context.journal).snapshot }
	if (snapshot.matches('failed'))
		return { kind: 'failed', problem: required(snapshot.context.problem) }
	if (snapshot.matches('available')) return { kind: 'available' }
	if (snapshot.matches('unavailable')) return { kind: 'unavailable' }
	if (snapshot.matches('capturing')) return { kind: 'capturing' }
	return { kind: snapshot.matches('closed') ? 'closed' : 'working' }
}
