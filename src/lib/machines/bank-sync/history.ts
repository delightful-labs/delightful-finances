import type { ActorRef, Snapshot } from 'xstate'
import { assign, enqueueActions, setup } from 'xstate'
import { required } from './identity.js'
import type { Connection, LastSync } from './types.js'

export type HistoryEvent = {
	type: 'HISTORY_REPORTED'
	generation: number
	summary: LastSync | undefined
}
type ReportingInput = {
	connection: Connection | undefined
	generation: number
	recipient: ActorRef<Snapshot<unknown>, HistoryEvent>
}
type Input = ReportingInput | Connection | undefined
type Context = {
	connection: Connection | undefined
	summary: LastSync | undefined
	generation: number
	recipient: ActorRef<Snapshot<unknown>, HistoryEvent> | undefined
}
type Event = { type: 'OBSERVED'; connection: Connection | undefined; generation: number }
type SummaryParams = { outcomeKey: LastSync['outcomeKey'] }

export const bankHistoryMachine = setup<
	Context,
	Event,
	{},
	{},
	{ summarize: SummaryParams; publish: undefined },
	{},
	never,
	string,
	Input
>({
	actions: {
		publish: enqueueActions(({ context, enqueue }) => {
			if (!context.recipient) return
			enqueue.sendTo(context.recipient, {
				type: 'HISTORY_REPORTED',
				generation: context.generation,
				summary: context.summary
			})
		}),
		summarize: assign(({ context }, params: SummaryParams) => {
			const connection = required(context.connection)
			return {
				summary: {
					time: required(connection.lastSyncAt),
					outcomeKey: params.outcomeKey,
					imported: connection.importedCount ?? 0,
					existing: connection.existingCount ?? 0,
					omitted: connection.omittedCount ?? 0
				}
			}
		})
	}
}).createMachine({
	id: 'bank-history',
	context: ({ input }) => ({
		...(input && 'recipient' in input
			? input
			: { connection: input, generation: 0, recipient: undefined }),
		summary: undefined
	}),
	initial: 'checkingConnection',
	on: {
		OBSERVED: {
			target: '.checkingConnection',
			actions: assign({
				connection: ({ event }) => event.connection,
				generation: ({ event }) => event.generation
			})
		}
	},
	states: {
		checkingConnection: {
			always: [
				{ guard: ({ context }) => !context.connection, target: 'absent' },
				{ target: 'checkingTime' }
			]
		},
		checkingTime: {
			always: [
				{ guard: ({ context }) => !context.connection?.lastSyncAt, target: 'absent' },
				{ target: 'checkingOutcome' }
			]
		},
		checkingOutcome: {
			always: [
				{
					guard: ({ context }) => context.connection?.lastOutcome === 'succeeded',
					target: 'succeeded'
				},
				{
					guard: ({ context }) => context.connection?.lastOutcome === 'partial',
					target: 'partial'
				},
				{ guard: ({ context }) => context.connection?.lastOutcome === 'failed', target: 'failed' },
				{ target: 'absent' }
			]
		},
		absent: { entry: [assign({ summary: undefined }), 'publish'] },
		succeeded: {
			entry: [{ type: 'summarize', params: { outcomeKey: 'bank.succeeded' } }, 'publish']
		},
		partial: { entry: [{ type: 'summarize', params: { outcomeKey: 'bank.partial' } }, 'publish'] },
		failed: { entry: [{ type: 'summarize', params: { outcomeKey: 'bank.failed' } }, 'publish'] }
	}
})
