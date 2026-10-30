import type { PaymentMethod } from '#lib/domain/payment-method.js'
import { TRANSACTION_SOURCE, type TransactionSource } from '#lib/domain/transaction-source.js'
import type { TransactionKind } from '#lib/domain/transaction-kind.js'
import { assign, fromPromise, setup, stateIn, type OutputFrom } from 'xstate'
import { PersistedWriteRejectedError } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { z } from 'zod'
import { app, type Tag, type TransactionRow, type Check } from '#lib/schema.js'
import { normalizedName } from '#lib/domain/names.js'
import { appTagSchema } from '#lib/validation/tags.js'
import { independentTransactionSchema } from '#lib/validation/transactions.js'
import type { IndependentTransaction } from '#lib/domain/transaction.js'
import type { FormInterruption, FormSettlement } from '#lib/contracts/form-contract.js'
import { transferEditRequiresUnlink } from '#lib/contracts/transaction-save-contract.js'

type TransactionDb = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
type Transaction = ReturnType<TransactionDb['beginTransaction']>
const inputSchema = z.strictObject({
	transactionId: z.uuid(),
	values: independentTransactionSchema,
	mode: z.enum(['create', 'edit']).optional(),
	moveCheckFromAccountId: z.uuid().optional()
})
export type IndependentTransactionInput = z.output<typeof inputSchema>
export type IndependentTransactionEvent = { type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN' }
export type IndependentTransactionResult =
	| { outcome: 'succeeded' | FormInterruption; transactionId: string; settlement: FormSettlement }
	| {
			outcome: 'failed'
			transactionId: string
			settlement: FormSettlement
			reason?: 'linkedTransferRequiresUnlink'
	  }
type Plan = {
	moveCheck?: { id: string; accountId: string } | undefined
	row: {
		organizationId: string
		accountId: string
		categoryId: string
		amountMinor: number
		currency: string
		kind: TransactionKind
		bookedOn: string
		description: string | null
		memo: string | null
		source: TransactionSource
		externalId?: string
		paymentMethod: PaymentMethod | null
		checkId: string | null
	}
	remove: string[]
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
function planTransaction(
	values: IndependentTransaction,
	tags: readonly Tag[],
	retained: readonly Tag[] = []
): Plan {
	const names = values.tags ?? []
	const retainedNames = new Set(retained.map((tag) => normalizedName(tag.name)))
	if (
		names.some(
			(name) =>
				!retainedNames.has(normalizedName(name)) &&
				tags.some(
					(tag) =>
						tag.organizationId === values.organizationId &&
						tag.kind === values.kind &&
						Boolean(tag.archivedAt) &&
						normalizedName(tag.name) === normalizedName(name)
				)
		)
	)
		throw new Error('An archived transaction tag cannot be selected')
	if (
		names.some(
			(name) =>
				!retained.some((tag) => normalizedName(tag.name) === normalizedName(name)) &&
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
		const tag = [...retained, ...active].find(
			(candidate) => normalizedName(candidate.name) === normalizedName(name)
		)
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
		...(values.source.source === TRANSACTION_SOURCE.SIMPLEFIN
			? { externalId: values.source.externalId }
			: {}),
		paymentMethod: values.paymentMethod,
		checkId: values.checkId
	}
	return { row, tags: uniqueTags, remove: [] }
}
const read = fromPromise(
	({ input }: { input: { tx: Transaction; values: IndependentTransaction } }) =>
		input.tx.all(
			app.tags.where({ organizationId: input.values.organizationId, kind: input.values.kind })
		)
)
const readEdit = fromPromise(async ({ input }: { input: { tx: Transaction; id: string } }) => {
	const results = await Promise.allSettled([
		Promise.resolve().then(() => input.tx.all(app.transactions.where({ id: input.id }))),
		Promise.resolve().then(() =>
			input.tx.all(app.transactionTags.where({ transactionId: input.id }))
		),
		Promise.resolve().then(() =>
			input.tx.all(app.internalTransfers.where({ expenseTransactionId: input.id }))
		),
		Promise.resolve().then(() =>
			input.tx.all(app.internalTransfers.where({ incomeTransactionId: input.id }))
		)
	])
	const [rows, links, expenseTransfers, incomeTransfers] = results
	if (rows.status === 'rejected') throw rows.reason
	if (links.status === 'rejected') throw links.reason
	if (expenseTransfers.status === 'rejected') throw expenseTransfers.reason
	if (incomeTransfers.status === 'rejected') throw incomeTransfers.reason
	return {
		existing: rows.value[0],
		links: links.value,
		transfers: [...expenseTransfers.value, ...incomeTransfers.value]
	}
})
type EditSnapshot = OutputFrom<typeof readEdit>
function editable(existing: TransactionRow | undefined, values: IndependentTransaction) {
	return (
		existing !== undefined &&
		existing.organizationId === values.organizationId &&
		existing.kind === values.kind &&
		existing.source === values.source.source &&
		(values.source.source !== TRANSACTION_SOURCE.SIMPLEFIN ||
			existing.externalId === values.source.externalId)
	)
}
const readMoveCheck = fromPromise(({ input }: { input: { tx: Transaction; id: string } }) =>
	input.tx.all(app.checks.where({ id: input.id }))
)
const prepare = fromPromise(
	({
		input
	}: {
		input: {
			values: IndependentTransaction
			tags: readonly Tag[]
			edit: EditSnapshot | undefined
			moveCheck: Check | undefined
		}
	}) => {
		const retained = input.tags.filter(
			(tag) =>
				tag.organizationId === input.values.organizationId &&
				tag.kind === input.values.kind &&
				input.edit?.links.some((link) => link.tagId === tag.id)
		)
		const plan = planTransaction(input.values, input.tags, retained)
		plan.moveCheck = input.moveCheck
			? { id: input.moveCheck.id, accountId: input.values.accountId }
			: undefined
		const desired = new Set(plan.tags.map((tag) => tag.id))
		plan.remove =
			input.edit?.links.filter((link) => !desired.has(link.tagId)).map((link) => link.id) ?? []
		plan.tags = plan.tags.filter((tag) => !input.edit?.links.some((link) => link.tagId === tag.id))
		return Promise.resolve(plan)
	}
)
type StageInput = {
	tx: Transaction
	plan: Plan
	transactionId: string
	edit?: EditSnapshot | undefined
}
function stageTags({ tx, plan, transactionId }: StageInput) {
	for (const id of plan.remove) tx.delete(app.transactionTags, id)
	for (const tag of plan.tags) {
		if (tag.values) tx.insert(app.tags, tag.values, { id: tag.id })
		tx.insert(app.transactionTags, {
			organizationId: plan.row.organizationId,
			transactionId,
			tagId: tag.id
		})
	}
}
const stage = fromPromise(({ input }: { input: StageInput }) => {
	input.tx.insert(app.transactions, input.plan.row, { id: input.transactionId })
	stageTags(input)
	return Promise.resolve()
})
const update = fromPromise(({ input }: { input: StageInput }) => {
	if (input.plan.moveCheck)
		input.tx.update(app.checks, input.plan.moveCheck.id, {
			accountId: input.plan.moveCheck.accountId
		})
	input.tx.update(app.transactions, input.transactionId, input.plan.row)
	stageTags(input)
	return Promise.resolve()
})
const commit = fromPromise(({ input }: { input: Transaction }) => Promise.resolve(input.commit()))
const settle = fromPromise(({ input }: { input: OutputFrom<typeof commit> }) =>
	input.wait({ tier: 'local' })
)
const rollback = fromPromise(({ input }: { input: Transaction }) => input.rollback())
type Context = {
	input: IndependentTransactionInput | undefined
	transactionId: string
	values: IndependentTransaction | undefined
	tx: Transaction | undefined
	tags: readonly Tag[]
	edit: EditSnapshot | undefined
	moveCheck: Check | undefined
	plan: Plan | undefined
	handle: OutputFrom<typeof commit> | undefined
	settlement: FormSettlement
	failureReason: 'linkedTransferRequiresUnlink' | undefined
	result: IndependentTransactionResult | undefined
}
const actors = {
	validate,
	open,
	read,
	prepare,
	stage,
	commit,
	settle,
	rollback,
	readEdit,
	readMoveCheck,
	update
}

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
					settlement: context.settlement,
					...(outcome === 'failed' && context.failureReason
						? { reason: context.failureReason }
						: {})
				}),
				input: undefined,
				values: undefined,
				tx: undefined,
				tags: [],
				edit: undefined,
				moveCheck: undefined,
				plan: undefined,
				handle: undefined
			})
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
			edit: undefined,
			moveCheck: undefined,
			plan: undefined,
			handle: undefined,
			settlement: 'notStarted',
			failureReason: undefined,
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
										{ guard: 'interrupted', target: 'finishingFailure' },
										{
											guard: ({ event }) => event.output.success,
											target: 'opening',
											actions: assign({
												values: ({ event }) =>
													event.output.success ? event.output.data.values : undefined
											})
										},
										{ target: 'finishingFailure' }
									],
									onError: 'finishingFailure'
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
											guard: ({ context }) => context.input?.mode === 'edit',
											target: 'readingEdit',
											actions: assign({ tx: ({ event }) => event.output })
										},
										{
											guard: ({ context }) => Boolean(context.values?.tags?.length),
											target: 'reading',
											actions: assign({ tx: ({ event }) => event.output })
										},
										{
											target: 'planning',
											actions: assign({ tx: ({ event }) => event.output })
										}
									],
									onError: 'finishingFailure'
								}
							},
							readingEdit: {
								invoke: {
									src: 'readEdit',
									input: ({ context }) => ({ tx: required(context.tx), id: context.transactionId }),
									onDone: {
										target: 'checkingEdit',
										actions: assign({ edit: ({ event }) => event.output })
									},
									onError: 'rollingBack'
								}
							},
							checkingEdit: {
								always: [
									{ guard: 'interrupted', target: 'rollingBack' },
									{
										guard: ({ context }) =>
											editable(context.edit?.existing, required(context.values)) &&
											transferEditRequiresUnlink(
												context.edit?.existing,
												required(context.values),
												(context.edit?.transfers.length ?? 0) > 0
											),
										target: 'rollingBack',
										actions: assign({ failureReason: 'linkedTransferRequiresUnlink' })
									},
									{
										guard: ({ context }) =>
											editable(context.edit?.existing, required(context.values)),
										target: 'assessingMove'
									},
									{ target: 'rollingBack' }
								]
							},
							assessingMove: {
								always: [
									{ guard: 'interrupted', target: 'rollingBack' },
									{
										guard: ({ context }) => context.input?.moveCheckFromAccountId !== undefined,
										target: 'readingMoveCheck'
									},
									{ target: 'reading' }
								]
							},
							readingMoveCheck: {
								invoke: {
									src: 'readMoveCheck',
									input: ({ context }) => ({
										tx: required(context.tx),
										id: required(required(context.values).checkId ?? undefined)
									}),
									onDone: {
										target: 'checkingMove',
										actions: assign({ moveCheck: ({ event }) => event.output[0] })
									},
									onError: 'rollingBack'
								}
							},
							checkingMove: {
								always: [
									{ guard: 'interrupted', target: 'rollingBack' },
									{
										guard: ({ context }) =>
											context.moveCheck !== undefined &&
											context.moveCheck.id === context.edit?.existing?.checkId &&
											context.moveCheck.id === context.values?.checkId &&
											context.moveCheck.organizationId === context.values?.organizationId &&
											context.moveCheck.accountId === context.input?.moveCheckFromAccountId &&
											context.moveCheck.accountId === context.edit?.existing?.accountId,
										target: 'reading'
									},
									{ target: 'rollingBack' }
								]
							},
							reading: {
								invoke: {
									src: 'read',
									input: ({ context }) => ({
										tx: required(context.tx),
										values: required(context.values)
									}),
									onDone: [
										{ guard: 'interrupted', target: 'rollingBack' },
										{
											target: 'planning',
											actions: assign({ tags: ({ event }) => event.output })
										}
									],
									onError: 'rollingBack'
								}
							},
							planning: {
								invoke: {
									src: 'prepare',
									input: ({ context }) => ({
										values: required(context.values),
										tags: context.tags,
										edit: context.edit,
										moveCheck: context.moveCheck
									}),
									onDone: [
										{ guard: 'interrupted', target: 'rollingBack' },
										{
											guard: ({ context }) => context.input?.mode === 'edit',
											target: 'updating',
											actions: assign({ plan: ({ event }) => event.output })
										},
										{
											target: 'staging',
											actions: assign({ plan: ({ event }) => event.output })
										}
									],
									onError: 'rollingBack'
								}
							},
							updating: {
								invoke: {
									src: 'update',
									input: ({ context }) => ({
										tx: required(context.tx),
										plan: required(context.plan),
										transactionId: context.transactionId,
										edit: context.edit
									}),
									onDone: [
										{ guard: 'interrupted', target: 'rollingBack' },
										{ target: 'committing' }
									],
									onError: 'rollingBack'
								}
							},
							staging: {
								invoke: {
									src: 'stage',
									input: ({ context }) => ({
										tx: required(context.tx),
										plan: required(context.plan),
										transactionId: context.transactionId
									}),
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
										target: 'finishingSuccess',
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
												context.settlement === 'rejected' ||
												(event.output && context.settlement === 'notStarted')
													? 'rejected'
													: 'unknown'
										})
									},
									onError: {
										target: 'finishingFailure',
										actions: assign({
											settlement: ({ context }) =>
												context.settlement === 'rejected' ? 'rejected' : 'unknown'
										})
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
