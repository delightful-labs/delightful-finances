import { assign, fromPromise, setup, stateIn, type OutputFrom } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import { app, type Tag } from '#lib/schema.js'
import { normalizedName } from '#lib/domain/names.js'
import { appTransactionSchema } from '#lib/validation/transactions.js'
import { appTagSchema } from '#lib/validation/tags.js'
import type { AppTransaction } from '#lib/domain/transaction.js'
import type {
	FormChildEvent,
	FormOperationInput,
	FormOperationResult,
	FormSettlement
} from '#lib/form-contract.js'
import type {
	TransactionEntryObservation,
	TransactionEntryScope,
	TransactionEntryReason
} from '#lib/transaction-entry-contract.js'

export type CreationDb = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
type Input = FormOperationInput<AppTransaction, TransactionEntryScope, TransactionEntryObservation>
type Result = FormOperationResult<void, TransactionEntryReason>
type Transaction = ReturnType<CreationDb['beginTransaction']>
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing creation resource')
	return value
}

// Pure preparation: choose all row values and IDs before staging any writes.
function planCreation(transaction: AppTransaction, existing: readonly Tag[]) {
	const archivedSelection = (transaction.tags ?? []).some((name) =>
		existing.some(
			(tag) =>
				tag.organizationId === transaction.organizationId &&
				tag.kind === transaction.kind &&
				Boolean(tag.archivedAt) &&
				normalizedName(tag.name) === normalizedName(name)
		)
	)
	if (archivedSelection)
		return { kind: 'archivedSelection' } satisfies { kind: 'archivedSelection' }
	const ambiguous = (transaction.tags ?? []).some(
		(name) =>
			existing.filter(
				(tag) =>
					tag.organizationId === transaction.organizationId &&
					tag.kind === transaction.kind &&
					!tag.archivedAt &&
					normalizedName(tag.name) === normalizedName(name)
			).length > 1
	)
	if (ambiguous) return { kind: 'ambiguous' } satisfies { kind: 'ambiguous' }
	const transactionId = crypto.randomUUID()
	const check =
		'paymentMethod' in transaction && transaction.paymentMethod === 'check'
			? {
					transactionId,
					organizationId: transaction.organizationId,
					accountId: transaction.accountId,
					checkNumber: transaction.checkDetails.checkNumber,
					checkDate: transaction.checkDetails.checkDate,
					...(transaction.checkDetails.payerName === undefined
						? {}
						: { payerName: transaction.checkDetails.payerName }),
					...(transaction.checkDetails.bankName === undefined
						? {}
						: { bankName: transaction.checkDetails.bankName }),
					...(transaction.checkDetails.memoOnCheck === undefined
						? {}
						: { memoOnCheck: transaction.checkDetails.memoOnCheck })
				}
			: undefined
	const row = {
		organizationId: transaction.organizationId,
		accountId: transaction.accountId,
		categoryId: transaction.categoryId,
		amountMinor: transaction.money.amountMinor,
		currency: transaction.money.currency,
		kind: transaction.kind,
		bookedOn: transaction.bookedOn,
		...(transaction.description ? { description: transaction.description } : {}),
		...(transaction.memo ? { memo: transaction.memo } : {}),
		source: transaction.source.source,
		...(transaction.source.source === 'simplefin'
			? { externalId: transaction.source.externalId }
			: {}),
		...('paymentMethod' in transaction ? { paymentMethod: transaction.paymentMethod } : {}),
		...(check ? { checkDetailsId: transactionId } : {})
	}
	const tags = (transaction.tags ?? []).map((name) => {
		const tag = existing.find(
			(tag) =>
				tag.organizationId === transaction.organizationId &&
				tag.kind === transaction.kind &&
				!tag.archivedAt &&
				normalizedName(tag.name) === normalizedName(name)
		)
		return {
			id: tag?.id ?? crypto.randomUUID(),
			values: tag
				? undefined
				: appTagSchema.parse({
						organizationId: transaction.organizationId,
						kind: transaction.kind,
						name,
						categoryId: transaction.categoryId
					})
		}
	})
	return { kind: 'planned', transactionId, check, row, tags } satisfies {
		kind: 'planned'
		transactionId: string
		check: unknown
		row: unknown
		tags: unknown
	}
}
type Plan = Extract<ReturnType<typeof planCreation>, { transactionId: string }>
const validate = fromPromise(({ input }: { input: AppTransaction }) =>
	Promise.resolve(appTransactionSchema.safeParse(input))
)
const open = fromPromise(({ input }: { input: CreationDb }) =>
	Promise.resolve(input.beginTransaction())
)
const read = fromPromise(({ input }: { input: { tx: Transaction; values: AppTransaction } }) =>
	input.tx.all(
		app.tags.where({ organizationId: input.values.organizationId, kind: input.values.kind })
	)
)
const plan = fromPromise(({ input }: { input: { values: AppTransaction; tags: readonly Tag[] } }) =>
	Promise.resolve(planCreation(input.values, input.tags))
)
const stage = fromPromise(async ({ input }: { input: { tx: Transaction; plan: Plan } }) => {
	const { tx, plan } = input
	if (plan.check) tx.insert(app.checkDetails, plan.check, { id: plan.transactionId })
	tx.insert(app.transactions, plan.row, { id: plan.transactionId })
	for (const tag of plan.tags) {
		if (tag.values) tx.insert(app.tags, tag.values, { id: tag.id })
		tx.insert(app.transactionTags, {
			organizationId: plan.row.organizationId,
			transactionId: plan.transactionId,
			tagId: tag.id
		})
	}
})
const commit = fromPromise(({ input }: { input: Transaction }) => Promise.resolve(input.commit()))
const settle = fromPromise(({ input }: { input: OutputFrom<typeof commit> }) =>
	input.wait({ tier: 'local' })
)
const rollback = fromPromise(({ input }: { input: Transaction }) => input.rollback())
type Context = {
	input: Input | undefined
	values: AppTransaction | undefined
	tx: Transaction | undefined
	tags: readonly Tag[]
	plan: Plan | undefined
	handle: OutputFrom<typeof commit> | undefined
	settlement: FormSettlement
	result: Result | undefined
}
const actors = { validate, open, read, plan, stage, commit, settle, rollback }

/** Owns one atomic creation transaction through rollback or actual commit settlement. */
export function createTransactionPersistenceMachine(db: CreationDb) {
	const model = setup<
		Context,
		FormChildEvent<TransactionEntryObservation>,
		typeof actors,
		{},
		{},
		{
			interrupted: undefined
			closing: undefined
			invalidated: undefined
			cancelling: undefined
		},
		never,
		string,
		Input,
		Result
	>({
		actors,
		guards: {
			interrupted: stateIn({ running: { control: 'interrupted' } }),
			closing: stateIn({ running: { control: { interrupted: 'closed' } } }),
			invalidated: stateIn({ running: { control: { interrupted: 'scopeChanged' } } }),
			cancelling: stateIn({ running: { control: { interrupted: 'cancelled' } } })
		}
	})
	const gate = (next: string) =>
		model.createStateConfig({
			always: [{ guard: 'interrupted', target: 'rollingBack' }, { target: next }]
		})
	return model.createMachine({
		id: 'transaction-create-persistence',
		initial: 'running',
		context: ({ input }) => ({
			input,
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
							finishingFailure: {
								id: 'creation-failure',
								always: [
									{ guard: 'closing', target: '#transaction-create-persistence.closed' },
									{ guard: 'invalidated', target: '#transaction-create-persistence.scopeChanged' },
									{ guard: 'cancelling', target: '#transaction-create-persistence.cancelled' },
									{ target: '#transaction-create-persistence.failed' }
								]
							},
							finishingSuccess: {
								id: 'creation-success',
								always: [
									{ guard: 'closing', target: '#transaction-create-persistence.closed' },
									{ guard: 'invalidated', target: '#transaction-create-persistence.scopeChanged' },
									{ guard: 'cancelling', target: '#transaction-create-persistence.cancelled' },
									{ target: '#transaction-create-persistence.succeeded' }
								]
							},
							validating: {
								invoke: {
									src: 'validate',
									input: ({ context }) => required(context.input).request.values,
									onDone: [
										{
											guard: ({ event }) => event.output.success,
											target: 'beforeOpen',
											actions: assign({ values: ({ event }) => event.output.data })
										},
										{ target: '#creation-failure' }
									],
									onError: '#creation-failure'
								}
							},
							beforeOpen: {
								always: [
									{ guard: 'interrupted', target: '#creation-failure' },
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
									onError: '#creation-failure'
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
									src: 'plan',
									input: ({ context }) => ({
										values: required(context.values),
										tags: context.tags
									}),
									onDone: [
										{
											guard: ({ event }) => event.output.kind === 'planned',
											target: 'beforeStage',
											actions: assign({
												plan: ({ event }) =>
													event.output.kind === 'planned' ? event.output : undefined
											})
										},
										{
											guard: ({ event }) => event.output.kind === 'archivedSelection',
											target: 'rollingBack'
										},
										{
											guard: ({ event }) => event.output.kind === 'ambiguous',
											target: 'rollingBack'
										},
										{ target: 'rollingBack' }
									],
									onError: 'rollingBack'
								}
							},
							beforeStage: gate('staging'),
							staging: {
								invoke: {
									src: 'stage',
									input: ({ context }) => ({
										tx: required(context.tx),
										plan: required(context.plan)
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
										target: '#creation-success',
										actions: assign({ settlement: 'locallyPersisted' })
									},
									onError: 'rollingBack'
								}
							},
							rollingBack: {
								invoke: {
									src: 'rollback',
									input: ({ context }) => required(context.tx),
									onDone: {
										target: '#creation-failure',
										actions: assign({
											settlement: ({ context, event }) =>
												event.output && context.settlement === 'notStarted' ? 'rejected' : 'unknown'
										})
									},
									onError: {
										target: '#creation-failure',
										actions: assign({ settlement: 'unknown' })
									}
								}
							}
						}
					}
				}
			},
			succeeded: {
				type: 'final',
				entry: assign({
					result: (): Result => ({
						outcome: 'succeeded',
						value: undefined,
						settlement: 'locallyPersisted'
					}),
					input: undefined,
					tx: undefined,
					values: undefined,
					tags: [],
					plan: undefined,
					handle: undefined
				})
			},
			failed: {
				type: 'final',
				entry: assign({
					result: ({ context }): Result => ({
						outcome: 'failed',
						code: 'operationFailed',
						settlement: context.settlement
					}),
					input: undefined,
					tx: undefined,
					values: undefined,
					tags: [],
					plan: undefined,
					handle: undefined
				})
			},
			cancelled: {
				type: 'final',
				entry: assign({
					result: ({ context }): Result => ({
						outcome: 'cancelled',
						settlement: context.settlement
					}),
					input: undefined,
					tx: undefined,
					values: undefined,
					tags: [],
					plan: undefined,
					handle: undefined
				})
			},
			scopeChanged: {
				type: 'final',
				entry: assign({
					result: ({ context }): Result => ({
						outcome: 'scopeChanged',
						settlement: context.settlement
					}),
					input: undefined,
					tx: undefined,
					values: undefined,
					tags: [],
					plan: undefined,
					handle: undefined
				})
			},
			closed: {
				type: 'final',
				entry: assign({
					result: ({ context }): Result => ({ outcome: 'closed', settlement: context.settlement }),
					input: undefined,
					tx: undefined,
					values: undefined,
					tags: [],
					plan: undefined,
					handle: undefined
				})
			}
		}
	})
}
