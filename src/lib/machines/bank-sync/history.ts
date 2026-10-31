import type { ActorRef, Snapshot } from 'xstate'
import { assign, enqueueActions, setup } from 'xstate'
import { required } from './identity.js'
import type { BankHistoryRecord, LastSync, Connection } from './types.js'
import type { SyncAttempt, SyncAccountResult } from '#lib/schema.js'
import type { BankMessage, BankLogPresentation } from '#lib/contracts/bank-presentation-contract.js'
import { m } from '#lib/paraglide/messages.js'
import { bankFailureStatuses } from './status.js'

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

const outcomeMessages = {
	unfinished: { label: m['labels.unspecified'] },
	succeeded: { label: m['bank.succeeded'] },
	partial: { label: m['bank.partial'] },
	failed: { label: m['bank.failed'] },
	cancelled: { label: m['status.cancelled'] }
} satisfies Record<SyncAttempt['outcome'], BankMessage>
const connectionMessages = {
	active: outcomeMessages.succeeded,
	error: outcomeMessages.failed,
	revoked: { label: () => m['status.unavailable_subject']({ subject: m['bank.title']() }) }
} satisfies Record<Connection['status'], BankMessage>
const settlementMessages = {
	notStarted: { label: m['bank.step_upcoming'] },
	locallyPersisted: { label: m['status.saved'] },
	confirmed: { label: m['bank.log_confirmed'] },
	unresolved: { label: m['bank.log_unresolved'] }
} satisfies Record<SyncAttempt['importSettlement'], BankMessage>
const failureMessages = {
	...bankFailureStatuses,
	authorization: { label: m['developer.unavailable'] },
	import: {
		label: () => m['errors.save_subject']({ subject: m['nouns.transaction']({ count: 2 }) })
	},
	unexpected: { label: m['errors.unexpected_title'] }
} satisfies Record<NonNullable<SyncAttempt['failureCode']>, BankMessage>

export function selectBankLogPresentation(input: {
	connections: readonly Pick<Connection, 'id' | 'ownerId' | 'claimedAt' | 'status'>[]
	attempts: readonly SyncAttempt[]
	accounts: readonly SyncAccountResult[]
}): BankLogPresentation {
	return {
		connections: input.connections.map((row) => ({
			...row,
			status: connectionMessages[row.status]
		})),
		attempts: input.attempts.map((row) => ({
			...row,
			outcome: outcomeMessages[row.outcome],
			importSettlement: settlementMessages[row.importSettlement],
			failure: row.failureCode ? failureMessages[row.failureCode] : undefined
		})),
		accounts: input.accounts.map((row) => ({
			...row,
			outcome: outcomeMessages[row.outcome],
			failure: row.failureCode ? failureMessages[row.failureCode] : undefined
		}))
	}
}
