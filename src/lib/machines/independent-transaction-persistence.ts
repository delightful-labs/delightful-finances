import { assign, fromPromise, setup, stateIn, type OutputFrom } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import { z } from 'zod'
import { app, type Tag } from '#lib/schema.js'
import { normalizedName } from '#lib/domain/names.js'
import { appTagSchema } from '#lib/validation/tags.js'
import { independentTransactionSchema } from '#lib/validation/transactions.js'
import type { IndependentTransaction } from '#lib/domain/transaction.js'
import type { FormInterruption, FormSettlement } from '#lib/form-contract.js'

type TransactionDb = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
type Transaction = ReturnType<TransactionDb['beginTransaction']>
const inputSchema = z.strictObject({
	transactionId: z.uuid(),
	values: independentTransactionSchema
})
export type IndependentTransactionInput = z.output<typeof inputSchema>
export type IndependentTransactionEvent = { type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN' }
export type IndependentTransactionResult = {
	outcome: 'succeeded' | 'failed' | FormInterruption
	transactionId: string
	settlement: FormSettlement
}
type Plan = {
	row: {
		organizationId: string
		accountId: string
		categoryId: string
		amountMinor: number
		currency: string
		kind: 'income' | 'expense'
		bookedOn: string
		description: string | null
		memo: string | null
		source: 'manual' | 'simplefin'
		externalId?: string
		paymentMethod?: 'cash' | 'check' | 'transfer' | 'electronic'
		checkId?: string
	}
	tags: { id: string; values: ReturnType<typeof appTagSchema.parse> | undefined }[]
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing transaction resource')
	return value
}
const validate = fromPromise(({ input }: { input: IndependentTransactionInput }) =>
	Promise.resolve(inputSchema.safeParse(input))
)
const open = fromPromise(({ input }: { input: TransactionDb }) =>
	Promise.resolve(input.beginTransaction())
)
function planTransaction(values: IndependentTransaction, tags: readonly Tag[]): Plan {
	const names = values.tags ?? []
	if (
		names.some(
			(name) =>
				tags.filter(
					(tag) =>
						tag.organizationId === values.organizationId &&
						tag.kind === values.kind &&
						!tag.archivedAt &&
						normalizedName(tag.name) === normalizedName(name)
				).length > 1
		)
	)
		throw new Error('Ambiguous transaction tag')
	const active = tags.filter(
		(tag) =>
			tag.organizationId === values.organizationId && tag.kind === values.kind && !tag.archivedAt
	)
	const additions = names.map((name) => {
		const tag = active.find((candidate) => normalizedName(candidate.name) === normalizedName(name))
		return {
			id: tag?.id ?? crypto.randomUUID(),
			values: tag
				? undefined
				: appTagSchema.parse({
						organizationId: values.organizationId,
						kind: values.kind,
						name,
						categoryId: values.categoryId
					})
		}
	})
	const uniqueTags = additions.filter(
		(tag, index) => additions.findIndex((candidate) => candidate.id === tag.id) === index
	)
	const row: Plan['row'] = {
		organizationId: values.organizationId,
		accountId: values.accountId,
		categoryId: values.categoryId,
		amountMinor: values.money.amountMinor,
		currency: values.money.currency,
		kind: values.kind,
		bookedOn: values.bookedOn,
		description: values.description ?? null,
		memo: values.memo ?? null,
		source: values.source.source,
		...(values.source.source === 'simplefin' ? { externalId: values.source.externalId } : {}),
		...(values.paymentMethod === null ? {} : { paymentMethod: values.paymentMethod }),
		...(values.checkId === null ? {} : { checkId: values.checkId })
	}
	return { row, tags: uniqueTags }
}
const read = fromPromise(
	({ input }: { input: { tx: Transaction; values: IndependentTransaction } }) =>
		Promise.resolve(
			input.values.tags?.length
				? input.tx.all(
						app.tags.where({ organizationId: input.values.organizationId, kind: input.values.kind })
					)
				: []
		)
)
const prepare = fromPromise(
	({ input }: { input: { values: IndependentTransaction; tags: readonly Tag[] } }) =>
		Promise.resolve(planTransaction(input.values, input.tags))
)
const stage = fromPromise(
	({ input }: { input: { tx: Transaction; plan: Plan; transactionId: string } }) => {
		input.tx.insert(app.transactions, input.plan.row, { id: input.transactionId })
		for (const tag of input.plan.tags) {
			if (tag.values) input.tx.insert(app.tags, tag.values, { id: tag.id })
			input.tx.insert(app.transactionTags, {
				organizationId: input.plan.row.organizationId,
				transactionId: input.transactionId,
				tagId: tag.id
			})
		}
		return Promise.resolve()
	}
)
const commit = fromPromise(({ input }: { input: Transaction }) => Promise.resolve(input.commit()))
const settle = fromPromise(({ input }: { input: OutputFrom<typeof commit> }) =>
	input.wait({ tier: 'local' })
)
const rollback = fromPromise(({ input }: { input: Transaction }) => input.rollback())
const noTransaction = fromPromise(() => Promise.resolve())
type Context = {
	input: IndependentTransactionInput | undefined
	transactionId: string
	values: IndependentTransaction | undefined
	tx: Transaction | undefined
	tags: readonly Tag[]
	plan: Plan | undefined
	handle: OutputFrom<typeof commit> | undefined
	settlement: FormSettlement
	result: IndependentTransactionResult | undefined
}
const actors = { validate, open, read, prepare, stage, commit, settle, rollback, noTransaction }

/** Owns the transaction and all tag writes for one caller-identified ledger entry. */
export function createIndependentTransactionPersistenceMachine(db: TransactionDb) {
	const model = setup<
		Context,
		IndependentTransactionEvent,
		typeof actors,
		{},
		{},
		{ interrupted: undefined; closing: undefined; invalidated: undefined; cancelling: undefined },
		never,
		string,
		IndependentTransactionInput,
		IndependentTransactionResult
	>({
		actors,
		guards: {
			interrupted: stateIn({ running: { control: 'interrupted' } }),
			closing: stateIn({ running: { control: { interrupted: 'closed' } } }),
			invalidated: stateIn({ running: { control: { interrupted: 'scopeChanged' } } }),
			cancelling: stateIn({ running: { control: { interrupted: 'cancelled' } } })
		}
	})
	const terminal = (outcome: IndependentTransactionResult['outcome']) =>
		model.createStateConfig({
			type: 'final',
			entry: assign({
				result: ({ context }): IndependentTransactionResult => ({
					outcome,
					transactionId: context.transactionId,
					settlement: context.settlement
				}),
				input: undefined,
				values: undefined,
				tx: undefined,
				tags: [],
				plan: undefined,
				handle: undefined
			})
		})
	const gate = (next: string) =>
		model.createStateConfig({
			always: [{ guard: 'interrupted', target: 'rollingBack' }, { target: next }]
		})
	return model.createMachine({
		id: 'independent-transaction-persistence',
		initial: 'running',
		context: ({ input }) => ({
			input,
			transactionId: input.transactionId,
			values: undefined,
			tx: undefined,
			tags: [],
			plan: undefined,
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
									input: ({ context }) => required(context.input),
									onDone: [
										{
											guard: ({ event }) => event.output.success,
											target: 'beforeOpen',
											actions: assign({
												values: ({ event }) =>
													event.output.success ? event.output.data.values : undefined
											})
										},
										{ target: '#independent-transaction-persistence.failed' }
									],
									onError: '#independent-transaction-persistence.failed'
								}
							},
							beforeOpen: {
								always: [
									{ guard: 'interrupted', target: 'finishingFailure' },
									{ target: 'opening' }
								]
							},
							opening: {
								invoke: {
									src: 'open',
									input: () => db,
									onDone: {
										target: 'beforeRead',
										actions: assign({ tx: ({ event }) => event.output })
									},
									onError: 'finishingFailure'
								}
							},
							beforeRead: {
								always: [
									{ guard: 'interrupted', target: 'rollingBack' },
									{
										guard: ({ context }) => Boolean(context.values?.tags?.length),
										target: 'reading'
									},
									{ target: 'planning' }
								]
							},
							reading: {
								invoke: {
									src: 'read',
									input: ({ context }) => ({
										tx: required(context.tx),
										values: required(context.values)
									}),
									onDone: {
										target: 'beforePlan',
										actions: assign({ tags: ({ event }) => event.output })
									},
									onError: 'rollingBack'
								}
							},
							beforePlan: gate('planning'),
							planning: {
								invoke: {
									src: 'prepare',
									input: ({ context }) => ({
										values: required(context.values),
										tags: context.tags
									}),
									onDone: {
										target: 'beforeStage',
										actions: assign({ plan: ({ event }) => event.output })
									},
									onError: 'rollingBack'
								}
							},
							beforeStage: gate('staging'),
							staging: {
								invoke: {
									src: 'stage',
									input: ({ context }) => ({
										tx: required(context.tx),
										plan: required(context.plan),
										transactionId: context.transactionId
									}),
									onDone: 'beforeCommit',
									onError: 'rollingBack'
								}
							},
							beforeCommit: gate('committing'),
							committing: {
								entry: assign({ settlement: 'unknown' }),
								invoke: {
									src: 'commit',
									input: ({ context }) => required(context.tx),
									onDone: {
										target: 'settling',
										actions: assign({ handle: ({ event }) => event.output })
									},
									onError: 'rollingBack'
								}
							},
							settling: {
								invoke: {
									src: 'settle',
									input: ({ context }) => required(context.handle),
									onDone: {
										target: 'finishingSuccess',
										actions: assign({ settlement: 'locallyPersisted' })
									},
									onError: 'rollingBack'
								}
							},
							rollingBack: {
								always: [
									{ guard: ({ context }) => context.tx === undefined, target: 'finishingFailure' },
									{ target: 'rollbackTransaction' }
								]
							},
							rollbackTransaction: {
								invoke: {
									src: 'rollback',
									input: ({ context }) => required(context.tx),
									onDone: {
										target: 'finishingFailure',
										actions: assign({
											settlement: ({ context, event }) =>
												event.output && context.settlement === 'notStarted' ? 'rejected' : 'unknown'
										})
									},
									onError: {
										target: 'finishingFailure',
										actions: assign({ settlement: 'unknown' })
									}
								}
							},
							finishingSuccess: {
								always: [
									{ guard: 'closing', target: '#independent-transaction-persistence.closed' },
									{
										guard: 'invalidated',
										target: '#independent-transaction-persistence.scopeChanged'
									},
									{ guard: 'cancelling', target: '#independent-transaction-persistence.cancelled' },
									{ target: '#independent-transaction-persistence.succeeded' }
								]
							},
							finishingFailure: {
								always: [
									{ guard: 'closing', target: '#independent-transaction-persistence.closed' },
									{
										guard: 'invalidated',
										target: '#independent-transaction-persistence.scopeChanged'
									},
									{ guard: 'cancelling', target: '#independent-transaction-persistence.cancelled' },
									{ target: '#independent-transaction-persistence.failed' }
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
