import { assign, setup } from 'xstate'
import { required } from './identity.js'
import type { Connection, LastSync } from './types.js'

type Context = { connection: Connection | undefined; summary: LastSync | undefined }
type Event = { type: 'OBSERVED'; connection: Connection | undefined }
type SummaryParams = { outcomeKey: LastSync['outcomeKey'] }

export const bankHistoryMachine = setup<
	Context,
	Event,
	{},
	{},
	{ summarize: SummaryParams },
	{},
	never,
	string,
	Connection | undefined
>({
	actions: {
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
	context: ({ input }) => ({ connection: input, summary: undefined }),
	initial: 'checkingConnection',
	on: {
		OBSERVED: {
			target: '.checkingConnection',
			actions: assign({ connection: ({ event }) => event.connection })
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
		absent: { entry: assign({ summary: undefined }) },
		succeeded: { entry: { type: 'summarize', params: { outcomeKey: 'bank.succeeded' } } },
		partial: { entry: { type: 'summarize', params: { outcomeKey: 'bank.partial' } } },
		failed: { entry: { type: 'summarize', params: { outcomeKey: 'bank.failed' } } }
	}
})
