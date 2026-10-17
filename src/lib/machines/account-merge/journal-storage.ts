import { assign, setup } from 'xstate'
import type { AccountMergeJournal } from '../../schema/account-merge-journal.js'
import {
	journalConnectionActor,
	readJournalActor,
	replaceJournalActor,
	removeJournalActor,
	type ConnectionEvent,
	type JournalErrorCode,
	type JournalTransactionEvent,
	type MergeJournalStorage
} from '../../account-merge/journal.js'
import { required } from '../bank-sync/identity.js'

export type JournalStorageResult =
	| { type: 'READ'; journal: AccountMergeJournal | null }
	| { type: 'WRITTEN'; journal: AccountMergeJournal | null }
	| { type: 'ERROR'; code: JournalErrorCode }
type Request =
	| { type: 'READ' }
	| { type: 'REPLACE'; expected: AccountMergeJournal | null; journal: AccountMergeJournal }
	| { type: 'REMOVE'; expected: AccountMergeJournal | null }
type Event = Request | ConnectionEvent | JournalTransactionEvent | { type: 'CANCEL' }
type Context = MergeJournalStorage & {
	request: Request | undefined
	db: IDBDatabase | undefined
	result: JournalStorageResult | undefined
}
const actors = {
	connection: journalConnectionActor,
	read: readJournalActor,
	replace: replaceJournalActor,
	remove: removeJournalActor
}
const workflow = setup<
	Context,
	Event,
	typeof actors,
	{},
	{},
	{},
	never,
	string,
	MergeJournalStorage,
	JournalStorageResult
>({ actors })
const release = workflow.assign({ db: undefined, request: undefined })

// Cancellation changes only the nested state, preserving the transaction child
// until it reports actual commit/abort. The connection owner outlives both.
const access = (src: 'read' | 'replace' | 'remove') =>
	workflow.createStateConfig({
		initial: 'active',
		invoke: {
			id: 'transaction',
			src,
			onError: {
				target: '#journal-storage.closing',
				actions: assign({
					result: () => ({ type: 'ERROR', code: 'storage' }) satisfies JournalStorageResult
				})
			},
			input: ({ context }) => ({
				db: required(context.db),
				expected: context.request?.type === 'READ' ? null : required(context.request).expected,
				next: context.request?.type === 'REPLACE' ? context.request.journal : null
			})
		},
		on: {
			SETTLED: {
				target: '#journal-storage.closing',
				actions: workflow.assign({
					result: ({ context, event }) =>
						event.type === 'SETTLED'
							? {
									type: context.request?.type === 'READ' ? 'READ' : 'WRITTEN',
									journal: event.journal
								}
							: context.result
				})
			},
			TRANSACTION_ERROR: {
				target: '#journal-storage.closing',
				actions: workflow.assign({
					result: ({ context, event }) =>
						event.type === 'TRANSACTION_ERROR'
							? { type: 'ERROR', code: event.code }
							: context.result
				})
			},
			CANCEL: { target: '.aborting', actions: workflow.sendTo('transaction', { type: 'CANCEL' }) }
		},
		states: { active: {}, aborting: { on: { CANCEL: {} } } }
	})

export const journalStorageActor = workflow.createMachine({
	id: 'journal-storage',
	context: ({ input }) => ({ ...input, request: undefined, db: undefined, result: undefined }),
	initial: 'waiting',
	invoke: {
		id: 'connection',
		src: 'connection',
		// A failed open acquired no connection; do not wait for a dead child's CLOSE acknowledgement.
		onError: {
			target: '.failed',
			actions: assign({
				result: () => ({ type: 'ERROR', code: 'storage' }) satisfies JournalStorageResult
			})
		}
	},
	output: ({ context }) => required(context.result),
	on: {
		CANCEL: {
			target: '.closing',
			actions: workflow.assign({ result: () => ({ type: 'ERROR', code: 'cancelled' }) })
		},
		CONNECTION_ERROR: {
			target: '.closing',
			actions: workflow.assign({
				result: ({ context, event }) =>
					event.type === 'CONNECTION_ERROR' ? { type: 'ERROR', code: event.code } : context.result
			})
		}
	},
	states: {
		waiting: {
			on: {
				READ: {
					target: 'checkingAvailability',
					actions: workflow.assign({ request: () => ({ type: 'READ' }) })
				},
				REPLACE: {
					target: 'checkingAvailability',
					actions: workflow.assign({
						request: ({ context, event }) => (event.type === 'REPLACE' ? event : context.request)
					})
				},
				REMOVE: {
					target: 'checkingAvailability',
					actions: workflow.assign({
						request: ({ context, event }) => (event.type === 'REMOVE' ? event : context.request)
					})
				}
			}
		},
		checkingAvailability: {
			always: [
				{
					guard: ({ context }) => !context.appId.trim() || !context.factory,
					target: 'closing',
					actions: workflow.assign({ result: () => ({ type: 'ERROR', code: 'unavailable' }) })
				},
				{ target: 'opening' }
			]
		},
		opening: {
			entry: workflow.sendTo('connection', ({ context }) => ({
				type: 'OPEN',
				factory: required(context.factory),
				name: `delightful-finances:account-merge:${context.appId}`
			})),
			on: {
				OPENED: {
					target: 'choosingTransaction',
					actions: workflow.assign({
						db: ({ context, event }) => (event.type === 'OPENED' ? event.db : context.db)
					})
				}
			}
		},
		choosingTransaction: {
			always: [
				{ guard: ({ context }) => context.request?.type === 'READ', target: 'reading' },
				{ guard: ({ context }) => context.request?.type === 'REPLACE', target: 'replacing' },
				{ target: 'removing' }
			]
		},
		reading: access('read'),
		replacing: access('replace'),
		removing: access('remove'),
		closing: {
			entry: workflow.sendTo('connection', { type: 'CLOSE' }),
			on: { CLOSED: 'classifyingResult', CANCEL: {}, CONNECTION_ERROR: {} }
		},
		classifyingResult: {
			always: [
				{
					guard: ({ context }) =>
						context.result?.type === 'ERROR' && context.result.code === 'cancelled',
					target: 'cancelled'
				},
				{
					guard: ({ context }) =>
						context.result?.type === 'ERROR' && context.result.code === 'conflict',
					target: 'conflicted'
				},
				{ guard: ({ context }) => context.result?.type === 'ERROR', target: 'failed' },
				{ target: 'completed' }
			]
		},
		completed: { type: 'final', entry: release },
		cancelled: { type: 'final', entry: release },
		conflicted: { type: 'final', entry: release },
		failed: { type: 'final', entry: release }
	}
})
