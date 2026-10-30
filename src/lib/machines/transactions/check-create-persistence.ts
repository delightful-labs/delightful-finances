import { assign, fromPromise, setup, stateIn, type OutputFrom } from 'xstate'
import { PersistedWriteRejectedError } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { z } from 'zod'
import { app } from '#lib/schema.js'
import { appCheckSchema } from '#lib/validation/checks.js'
import type { FormInterruption, FormSettlement } from '#lib/contracts/form-contract.js'

export type CheckCreationDb = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
const requestSchema = z.strictObject({
	id: z.uuid(),
	values: appCheckSchema,
	mode: z.enum(['create', 'edit']).optional()
})
export type CheckCreationInput = z.infer<typeof requestSchema>
export type CheckCreationEvent = { type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN' }
export type CheckCreationResult = {
	outcome: 'succeeded' | 'failed' | FormInterruption
	checkId: string
	settlement: FormSettlement
}
type Transaction = ReturnType<CheckCreationDb['beginTransaction']>
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing Check creation resource')
	return value
}
const validate = fromPromise(({ input }: { input: CheckCreationInput }) =>
	Promise.resolve(requestSchema.safeParse(input))
)
const open = fromPromise(({ input }: { input: CheckCreationDb }) =>
	Promise.resolve(input.beginTransaction())
)
const stage = fromPromise(
	({ input }: { input: { tx: Transaction; request: CheckCreationInput } }) => {
		input.tx.insert(
			app.checks,
			{
				...input.request.values,
				payerName: input.request.values.payerName ?? null,
				bankName: input.request.values.bankName ?? null,
				memoOnCheck: input.request.values.memoOnCheck ?? null
			},
			{ id: input.request.id }
		)
		return Promise.resolve()
	}
)
const update = fromPromise(
	({ input }: { input: { tx: Transaction; request: CheckCreationInput } }) => {
		input.tx.update(app.checks, input.request.id, {
			...input.request.values,
			payerName: input.request.values.payerName ?? null,
			bankName: input.request.values.bankName ?? null,
			memoOnCheck: input.request.values.memoOnCheck ?? null
		})
		return Promise.resolve()
	}
)
const commit = fromPromise(({ input }: { input: Transaction }) => Promise.resolve(input.commit()))
const settle = fromPromise(({ input }: { input: OutputFrom<typeof commit> }) =>
	input.wait({ tier: 'local' })
)
const rollback = fromPromise(({ input }: { input: Transaction }) => input.rollback())
type Context = {
	request: CheckCreationInput
	tx: Transaction | undefined
	handle: OutputFrom<typeof commit> | undefined
	settlement: FormSettlement
	result: CheckCreationResult | undefined
}

/** One attempt with a caller-owned stable ID; the staged save owner reconciles unknown results. */
export function createCheckCreationMachine(db: CheckCreationDb) {
	const actors = { validate, open, stage, update, commit, settle, rollback }
	const model = setup<
		Context,
		CheckCreationEvent,
		typeof actors,
		{},
		{},
		{ interrupted: undefined; closing: undefined; invalidated: undefined; cancelling: undefined },
		never,
		string,
		CheckCreationInput,
		CheckCreationResult
	>({
		actors,
		guards: {
			interrupted: stateIn({ running: { control: 'interrupted' } }),
			closing: stateIn({ running: { control: { interrupted: 'closed' } } }),
			invalidated: stateIn({ running: { control: { interrupted: 'scopeChanged' } } }),
			cancelling: stateIn({ running: { control: { interrupted: 'cancelled' } } })
		}
	})
	const terminal = (outcome: CheckCreationResult['outcome']) =>
		model.createStateConfig({
			type: 'final',
			entry: assign({
				result: ({ context }): CheckCreationResult => ({
					outcome,
					checkId: context.request.id,
					settlement: context.settlement
				}),
				tx: undefined,
				handle: undefined
			})
		})
	return model.createMachine({
		id: 'check-create-persistence',
		initial: 'running',
		context: ({ input }) => ({
			request: input,
			tx: undefined,
			handle: undefined,
			settlement: 'notStarted',
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		states: {
			running: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						on: {
							CANCEL: '.interrupted.cancelled',
							INVALIDATE: '.interrupted.scopeChanged',
							SHUTDOWN: '.interrupted.closed'
						},
						states: {
							active: {},
							interrupted: {
								initial: 'cancelled',
								states: {
									cancelled: { on: { CANCEL: {} } },
									scopeChanged: { on: { CANCEL: {}, INVALIDATE: {} } },
									closed: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {} } }
								}
							}
						}
					},
					flow: {
						initial: 'validating',
						states: {
							validating: {
								invoke: {
									src: 'validate',
									input: ({ context }) => context.request,
									onDone: [
										{ guard: 'interrupted', target: 'finishing' },
										{
											guard: ({ event }) => event.output.success,
											target: 'opening',
											actions: assign({
												request: ({ context, event }) =>
													event.output.success ? event.output.data : context.request
											})
										},
										{ target: 'finishing' }
									],
									onError: 'finishing'
								}
							},
							opening: {
								invoke: {
									src: 'open',
									input: () => db,
									onDone: [
										{
											guard: 'interrupted',
											target: 'rollingBack',
											actions: assign({ tx: ({ event }) => event.output })
										},
										{
											guard: ({ context }) => context.request.mode === 'edit',
											target: 'updating',
											actions: assign({ tx: ({ event }) => event.output })
										},
										{
											target: 'staging',
											actions: assign({ tx: ({ event }) => event.output })
										}
									],
									onError: 'finishing'
								}
							},
							staging: {
								invoke: {
									src: 'stage',
									input: ({ context }) => ({ tx: required(context.tx), request: context.request }),
									onDone: [
										{ guard: 'interrupted', target: 'rollingBack' },
										{ target: 'committing' }
									],
									onError: 'rollingBack'
								}
							},
							updating: {
								invoke: {
									src: 'update',
									input: ({ context }) => ({ tx: required(context.tx), request: context.request }),
									onDone: [
										{ guard: 'interrupted', target: 'rollingBack' },
										{ target: 'committing' }
									],
									onError: 'rollingBack'
								}
							},
							committing: {
								entry: assign({ settlement: 'unknown' }),
								invoke: {
									src: 'commit',
									input: ({ context }) => required(context.tx),
									onDone: {
										target: 'settling',
										actions: assign({ handle: ({ event }) => event.output })
									},
									onError: [
										{
											guard: ({ event }) => event.error instanceof PersistedWriteRejectedError,
											target: 'rollingBack',
											actions: assign({ settlement: 'rejected' })
										},
										{ target: 'rollingBack' }
									]
								}
							},
							settling: {
								invoke: {
									src: 'settle',
									input: ({ context }) => required(context.handle),
									onDone: {
										target: 'finishing',
										actions: assign({ settlement: 'locallyPersisted' })
									},
									onError: [
										{
											guard: ({ event }) => event.error instanceof PersistedWriteRejectedError,
											target: 'rollingBack',
											actions: assign({ settlement: 'rejected' })
										},
										{ target: 'rollingBack' }
									]
								}
							},
							rollingBack: {
								invoke: {
									src: 'rollback',
									input: ({ context }) => required(context.tx),
									onDone: {
										target: 'finishing',
										actions: assign({
											settlement: ({ context, event }) =>
												context.settlement === 'rejected' ||
												(event.output && context.settlement === 'notStarted')
													? 'rejected'
													: context.settlement === 'notStarted'
														? 'unknown'
														: context.settlement
										})
									},
									onError: {
										target: 'finishing',
										actions: assign({
											settlement: ({ context }) =>
												context.settlement === 'rejected' ? 'rejected' : 'unknown'
										})
									}
								}
							},
							finishing: {
								always: [
									{ guard: 'closing', target: '#check-create-persistence.closed' },
									{ guard: 'invalidated', target: '#check-create-persistence.scopeChanged' },
									{ guard: 'cancelling', target: '#check-create-persistence.cancelled' },
									{
										guard: ({ context }) => context.settlement === 'locallyPersisted',
										target: '#check-create-persistence.succeeded'
									},
									{ target: '#check-create-persistence.failed' }
								]
							}
						}
					}
				}
			},
			succeeded: terminal('succeeded'),
			failed: terminal('failed'),
			cancelled: terminal('cancelled'),
			scopeChanged: terminal('scopeChanged'),
			closed: terminal('closed')
		}
	})
}
