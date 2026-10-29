import type { ActorRef, Snapshot } from 'xstate'
import { assign, enqueueActions, setup } from 'xstate'
import { required } from './identity.js'
import type { BankHistoryRecord, LastSync } from './types.js'

export type HistoryEvent = {
	type: 'HISTORY_REPORTED'
	revision: number
	connectionId: string | undefined
	summary: LastSync | undefined
}
type Input = {
	revision: number
	recipient: ActorRef<Snapshot<unknown>, HistoryEvent>
}
type Context = Input & {
	records: readonly BankHistoryRecord[]
	connectionId: string | undefined
	summary: LastSync | undefined
}
type Event =
	| { type: 'BINDING_CHANGED'; revision: number }
	| { type: 'CONNECTION_SELECTED'; revision: number; connectionId: string | undefined }
	| { type: 'HISTORY_CHANGED'; revision: number; records: readonly BankHistoryRecord[] }
function selectedHistory(context: Context) {
	return context.records.find((row) => row.id === context.connectionId)
}
type SummaryParams = { outcomeKey: LastSync['outcomeKey'] }

export const bankHistoryMachine = setup<
	Context,
	Event,
	{},
	{},
	{ summarize: SummaryParams; publish: undefined },
	{ currentRevision: undefined },
	never,
	string,
	Input
>({
	guards: { currentRevision: ({ context, event }) => event.revision === context.revision },
	actions: {
		publish: enqueueActions(({ context, enqueue }) => {
			enqueue.sendTo(context.recipient, {
				type: 'HISTORY_REPORTED',
				revision: context.revision,
				connectionId: context.connectionId,
				summary: context.summary
			})
		}),
		summarize: assign(({ context }, params: SummaryParams) => {
			const connection = required(selectedHistory(context))
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
	tags: 'historical-outcome',
	context: ({ input }) => ({ ...input, records: [], connectionId: undefined, summary: undefined }),
	initial: 'checkingConnection',
	on: {
		BINDING_CHANGED: {
			target: '.checkingConnection',
			actions: assign({
				revision: ({ event }) => event.revision,
				records: [],
				connectionId: undefined
			})
		},
		CONNECTION_SELECTED: {
			guard: 'currentRevision',
			target: '.checkingConnection',
			actions: assign({ connectionId: ({ event }) => event.connectionId })
		},
		HISTORY_CHANGED: {
			guard: 'currentRevision',
			target: '.checkingConnection',
			actions: assign({ records: ({ event }) => event.records })
		}
	},
	states: {
		checkingConnection: {
			always: [
				{ guard: ({ context }) => !selectedHistory(context), target: 'absent' },
				{ target: 'checkingTime' }
			]
		},
		checkingTime: {
			always: [
				{ guard: ({ context }) => !selectedHistory(context)?.lastSyncAt, target: 'absent' },
				{ target: 'checkingOutcome' }
			]
		},
		checkingOutcome: {
			always: [
				{
					guard: ({ context }) => selectedHistory(context)?.lastOutcome === 'succeeded',
					target: 'succeeded'
				},
				{
					guard: ({ context }) => selectedHistory(context)?.lastOutcome === 'partial',
					target: 'partial'
				},
				{
					guard: ({ context }) => selectedHistory(context)?.lastOutcome === 'failed',
					target: 'failed'
				},
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
