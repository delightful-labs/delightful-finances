import { assign, setup } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import {
	transactionAttachmentRemovalMachine,
	type TransactionAttachmentRemovalResult
} from './transaction-attachment-removal.js'

type Db = Pick<ReturnType<typeof getDb>, 'all' | 'delete'>
export type TransactionAttachmentManagerInput = {
	db: Db
	transactionId: string
}
type Context = TransactionAttachmentManagerInput & {
	queue: string[]
	currentAttachmentId: string | undefined
	results: { attachmentId: string; result: TransactionAttachmentRemovalResult }[]
	shuttingDown: boolean
}
type Event =
	| { type: 'REMOVE'; attachmentId: string }
	| { type: 'SCOPE'; transactionId: string }
	| { type: 'SHUTDOWN' }

/** Owns repeated removal requests and drains the active removal child during page shutdown. */
export const transactionAttachmentManagerMachine = setup({
	types: {
		context: {} as Context,
		events: {} as Event,
		input: {} as TransactionAttachmentManagerInput
	},
	actors: { remove: transactionAttachmentRemovalMachine },
	actions: {
		enqueue: assign({
			queue: ({ context, event }) =>
				event.type === 'REMOVE' ? [...context.queue, event.attachmentId] : context.queue
		}),
		begin: assign({
			currentAttachmentId: ({ context }) => context.queue[0],
			queue: ({ context }) => context.queue.slice(1)
		}),
		recordFailure: assign({
			results: ({ context }) => [
				...context.results,
				{
					attachmentId: context.currentAttachmentId ?? '',
					result: { outcome: 'failed' }
				}
			],
			currentAttachmentId: undefined
		}),
		stop: assign({ shuttingDown: () => true }),
		replaceScope: assign({
			transactionId: ({ event }) => (event.type === 'SCOPE' ? event.transactionId : ''),
			queue: () => []
		})
	},
	guards: {
		canQueue: ({ context, event }) =>
			!context.shuttingDown &&
			event.type === 'REMOVE' &&
			!context.queue.includes(event.attachmentId) &&
			context.currentAttachmentId !== event.attachmentId,
		hasRequests: ({ context }) => context.queue.length > 0,
		stopping: ({ context }) => context.shuttingDown
	}
}).createMachine({
	id: 'transaction-attachment-manager',
	initial: 'checking',
	context: ({ input }) => ({
		...input,
		queue: [],
		currentAttachmentId: undefined,
		results: [],
		shuttingDown: false
	}),
	on: {
		REMOVE: { guard: 'canQueue', actions: 'enqueue' },
		SCOPE: { actions: 'replaceScope' },
		SHUTDOWN: { actions: 'stop' }
	},
	states: {
		checking: {
			always: [
				{ guard: 'stopping', target: 'closed' },
				{ guard: 'hasRequests', target: 'removing', actions: 'begin' },
				{ target: 'idle' }
			]
		},
		idle: {
			always: [{ guard: 'stopping', target: 'closed' }],
			on: { REMOVE: { guard: 'canQueue', target: 'checking', actions: 'enqueue' } }
		},
		removing: {
			invoke: {
				id: 'remove',
				src: 'remove',
				input: ({ context }) => ({
					db: context.db,
					transactionId: context.transactionId,
					attachmentId: context.currentAttachmentId ?? ''
				}),
				onDone: {
					target: 'checking',
					actions: assign({
						results: ({ context, event }) => [
							...context.results,
							{ attachmentId: context.currentAttachmentId ?? '', result: event.output }
						],
						currentAttachmentId: undefined
					})
				},
				onError: { target: 'checking', actions: 'recordFailure' }
			}
		},
		closed: { type: 'final' }
	}
})
