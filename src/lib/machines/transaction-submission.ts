import { assign, enqueueActions, setup, type SnapshotFrom } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import type {
	FormChildEvent,
	FormOperationInput,
	FormOperationResult
} from '#lib/contracts/form-contract.js'
import type {
	TransactionEntryObservation,
	TransactionEntryReason,
	TransactionEntryScope
} from '#lib/contracts/transaction-entry-contract.js'
import type { TransactionSaveValues } from '#lib/validation/transactions.js'
import { createTransactionAttachmentsMachine } from './transaction-attachments.js'
import {
	createTransactionSaveMachine,
	type TransactionSaveDb,
	type TransactionSaveResult
} from './transaction-save.js'

export type TransactionAttachmentDb = Pick<
	ReturnType<typeof getDb>,
	'all' | 'insert' | 'insertStreaming' | 'delete'
>
export type TransactionSubmissionDb = TransactionSaveDb & TransactionAttachmentDb
type Input = FormOperationInput<
	TransactionSaveValues,
	TransactionEntryScope,
	TransactionEntryObservation
>
type Result = FormOperationResult<void, TransactionEntryReason> & { transactionId?: string }
type Event = FormChildEvent<TransactionEntryObservation>
type Attachments = ReturnType<typeof createTransactionAttachmentsMachine>
type AttachmentsResult = SnapshotFrom<Attachments>['output']
type Context = {
	input: Input | undefined
	attachmentDb: (TransactionSaveDb & TransactionAttachmentDb) | undefined
	files: readonly File[]
	saved: TransactionSaveResult | undefined
	attachmentResult: AttachmentsResult | undefined
	result: Result | undefined
}

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing transaction submission result')
	return value
}

function hasAttachmentOperations(
	db: TransactionSaveDb
): db is TransactionSaveDb & TransactionAttachmentDb {
	return (
		'insert' in db &&
		typeof db.insert === 'function' &&
		'insertStreaming' in db &&
		typeof db.insertStreaming === 'function' &&
		'delete' in db &&
		typeof db.delete === 'function'
	)
}

function interruption(
	saved: TransactionSaveResult,
	outcome: 'cancelled' | 'scopeChanged' | 'closed'
): Result {
	return {
		outcome,
		settlement: saved.settlement,
		...(saved.checkpoint === undefined ? {} : { checkpoint: saved.checkpoint }),
		...(saved.transactionId === undefined ? {} : { transactionId: saved.transactionId })
	}
}

function attachmentFailure(saved: TransactionSaveResult): Result {
	return {
		...saved,
		outcome: 'partial',
		value: undefined,
		reason: 'attachmentsFailed',
		settlement: saved.settlement === 'confirmed' ? 'confirmed' : 'locallyPersisted'
	}
}

/** Keeps finance persistence independent, then coordinates its saved ID with the image batch. */
export function createTransactionSubmissionMachine(
	db: TransactionSaveDb,
	observe: () => TransactionEntryObservation,
	getAttachments: () => readonly File[] = () => []
) {
	const save = createTransactionSaveMachine(db, observe)
	const attachments = createTransactionAttachmentsMachine()
	const actors = { save, attachments }
	const model = setup<
		Context,
		Event,
		typeof actors,
		{},
		{ forward: undefined },
		{},
		never,
		string,
		Input,
		Result
	>({
		actors,
		actions: {
			forward: enqueueActions(({ self, event, enqueue }) => {
				const children = self.getSnapshot().children
				if (children.save?.getSnapshot().status === 'active') enqueue.sendTo(children.save, event)
				if (children.attachments?.getSnapshot().status === 'active' && event.type !== 'OBSERVE')
					enqueue.sendTo(children.attachments, event)
			})
		}
	})
	return model.createMachine({
		id: 'transaction-submission',
		initial: 'saving',
		context: ({ input }) => ({
			input,
			attachmentDb: hasAttachmentOperations(db) ? db : undefined,
			files: getAttachments(),
			saved: undefined,
			attachmentResult: undefined,
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		on: {
			OBSERVE: { actions: 'forward' },
			INVALIDATE: { actions: 'forward' },
			CANCEL: { actions: 'forward' },
			SHUTDOWN: { actions: 'forward' }
		},
		states: {
			saving: {
				invoke: {
					id: 'save',
					src: 'save',
					input: ({ context }) => {
						const input = required(context.input)
						return input
					},
					onDone: [
						{
							guard: ({ event }) =>
								(event.output.outcome === 'succeeded' || event.output.outcome === 'partial') &&
								event.output.transactionId !== undefined,
							target: 'checkingAttachments',
							actions: assign({ saved: ({ event }) => event.output })
						},
						{ target: 'completed', actions: assign({ result: ({ event }) => event.output }) }
					],
					onError: {
						target: 'completed',
						actions: assign({
							result: () => ({ outcome: 'failed', code: 'operationFailed', settlement: 'unknown' })
						})
					}
				}
			},
			checkingAttachments: {
				always: [
					{
						guard: ({ context }) => context.files.length > 0 && context.attachmentDb !== undefined,
						target: 'attaching'
					},
					{
						guard: ({ context }) => context.files.length > 0,
						target: 'completed',
						actions: assign({ result: ({ context }) => attachmentFailure(required(context.saved)) })
					},
					{
						target: 'completed',
						actions: assign({ result: ({ context }) => required(context.saved) })
					}
				]
			},
			attaching: {
				invoke: {
					id: 'attachments',
					src: 'attachments',
					input: ({ context }) => {
						const input = required(context.input)
						const saved = required(context.saved)
						const transactionId = required(saved.transactionId)
						return {
							db: required(context.attachmentDb),
							transaction: {
								id: transactionId,
								accountId: input.request.values.accountId,
								organizationId: input.request.values.organizationId
							},
							files: context.files
						}
					},
					onDone: {
						target: 'completingAttachments',
						actions: assign({ attachmentResult: ({ event }) => event.output })
					},
					onError: {
						target: 'completed',
						actions: assign({ result: ({ context }) => attachmentFailure(required(context.saved)) })
					}
				}
			},
			completingAttachments: {
				always: [
					{
						guard: ({ context }) => {
							const result = required(context.attachmentResult)
							return (
								result.outcome === 'closed' ||
								result.outcome === 'cancelled' ||
								result.outcome === 'scopeChanged'
							)
						},
						target: 'completed',
						actions: assign({
							result: ({ context }) =>
								interruption(
									required(context.saved),
									required(context.attachmentResult).outcome as
										'closed' | 'cancelled' | 'scopeChanged'
								)
						})
					},
					{
						guard: ({ context }) => {
							const result = required(context.attachmentResult)
							return result.outcome === 'complete' && result.failed === 0
						},
						target: 'completed',
						actions: assign({ result: ({ context }) => required(context.saved) })
					},
					{
						target: 'completed',
						actions: assign({
							result: ({ context }): Result => ({
								...required(context.saved),
								outcome: 'partial',
								value: undefined,
								reason: 'attachmentsFailed',
								settlement:
									required(context.saved).settlement === 'confirmed'
										? 'confirmed'
										: 'locallyPersisted'
							})
						})
					}
				]
			},
			completed: { type: 'final' }
		}
	})
}
