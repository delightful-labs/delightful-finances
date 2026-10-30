import {
	assign,
	enqueueActions,
	fromPromise,
	setup,
	stateIn,
	type ActorLogic,
	type Snapshot
} from 'xstate'
import type { AppTransaction } from '#lib/domain/transaction.js'
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

type CreationInput<Values = AppTransaction> = FormOperationInput<
	Values,
	TransactionEntryScope,
	TransactionEntryObservation
>
type Result = FormOperationResult<void, TransactionEntryReason>
type Event = FormChildEvent<TransactionEntryObservation> | { type: 'ADD' }

/** Batch iteration owns the current creation child until its transaction has settled. */
export function createSampleTransactionsMachine<
	Values,
	PersistenceSnapshot extends Snapshot<Result>
>(
	operation: ActorLogic<
		PersistenceSnapshot,
		FormChildEvent<TransactionEntryObservation>,
		CreationInput<Values>
	>,
	prepare: (index: number) => CreationInput<Values>
) {
	type Context = {
		saved: number
		request: CreationInput<Values> | undefined
		lastResult: Result | undefined
	}
	const actors = {
		prepare: fromPromise(({ input }: { input: number }) => Promise.resolve(prepare(input))),
		write: operation
	}
	const model = setup<
		Context,
		Event,
		typeof actors,
		{},
		{ forward: undefined },
		{
			closing: undefined
			interrupted: undefined
		}
	>({
		actors,
		actions: {
			forward: enqueueActions(({ self, event, enqueue }) => {
				const child = self.getSnapshot().children.write
				if (event.type !== 'ADD' && child?.getSnapshot().status === 'active')
					enqueue.sendTo(child, event)
			})
		},
		guards: {
			closing: stateIn({ saving: 'closing' }),
			interrupted: stateIn({ saving: 'interrupted' })
		}
	})
	return model.createMachine({
		initial: 'idle',
		context: { saved: 0, request: undefined, lastResult: undefined },
		on: { SHUTDOWN: '.closed', CANCEL: '.cancelled' },
		states: {
			idle: {
				on: { ADD: { target: 'preparing', actions: assign({ saved: 0, lastResult: undefined }) } }
			},
			preparing: {
				invoke: {
					src: 'prepare',
					input: ({ context }) => context.saved,
					onDone: { target: 'saving', actions: assign({ request: ({ event }) => event.output }) },
					onError: {
						target: 'assessingFailure',
						actions: assign({
							lastResult: (): Result => ({
								outcome: 'failed',
								code: 'validationFailed',
								settlement: 'notStarted'
							})
						})
					}
				},
				on: { INVALIDATE: 'assessingFailure' }
			},
			saving: {
				initial: 'pending',
				invoke: {
					id: 'write',
					src: 'write',
					input: ({ context }) => {
						if (!context.request) throw new Error('Missing sample request')
						return context.request
					},
					onDone: [
						{
							guard: 'closing',
							target: 'closed',
							actions: assign({
								lastResult: ({ event }) => event.output,
								saved: ({ context, event }) =>
									context.saved + (event.output?.settlement === 'locallyPersisted' ? 1 : 0)
							})
						},
						{
							guard: 'interrupted',
							target: 'assessingFailure',
							actions: assign({
								lastResult: ({ event }) => event.output,
								saved: ({ context, event }) =>
									context.saved + (event.output?.settlement === 'locallyPersisted' ? 1 : 0)
							})
						},
						{
							guard: ({ event }) => event.output?.outcome === 'succeeded',
							target: 'next',
							actions: assign({
								lastResult: ({ event }) => event.output,
								saved: ({ context }) => context.saved + 1
							})
						},
						{
							target: 'assessingFailure',
							actions: assign({
								lastResult: ({ event }) => event.output,
								saved: ({ context, event }) =>
									context.saved + (event.output?.settlement === 'locallyPersisted' ? 1 : 0)
							})
						}
					],
					onError: [
						{
							guard: 'closing',
							target: 'closed',
							actions: assign({
								lastResult: (): Result => ({
									outcome: 'failed',
									code: 'operationFailed',
									settlement: 'unknown'
								})
							})
						},
						{
							target: 'assessingFailure',
							actions: assign({
								lastResult: (): Result => ({
									outcome: 'failed',
									code: 'operationFailed',
									settlement: 'unknown'
								})
							})
						}
					]
				},
				on: {
					OBSERVE: { actions: 'forward' },
					INVALIDATE: { target: '.interrupted', actions: 'forward' },
					CANCEL: { target: '.interrupted', actions: 'forward' },
					SHUTDOWN: { target: '.closing', actions: 'forward' }
				},
				states: {
					pending: {},
					interrupted: { on: { CANCEL: {}, INVALIDATE: {} } },
					closing: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {}, OBSERVE: {} } }
				}
			},
			next: {
				entry: assign({ request: undefined }),
				always: [
					{ guard: ({ context }) => context.saved === 25, target: 'complete' },
					{ target: 'preparing' }
				]
			},
			assessingFailure: {
				entry: assign({ request: undefined }),
				always: [
					{ guard: ({ context }) => context.saved > 0, target: 'partial' },
					{ target: 'failure' }
				]
			},
			complete: {
				on: { ADD: { target: 'preparing', actions: assign({ saved: 0, lastResult: undefined }) } }
			},
			partial: {
				on: { ADD: { target: 'preparing', actions: assign({ saved: 0, lastResult: undefined }) } }
			},
			failure: {
				on: { ADD: { target: 'preparing', actions: assign({ saved: 0, lastResult: undefined }) } }
			},
			cancelled: { type: 'final', entry: assign({ request: undefined }) },
			closed: { type: 'final', entry: assign({ request: undefined }) }
		}
	})
}
