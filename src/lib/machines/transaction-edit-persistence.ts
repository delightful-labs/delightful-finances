import { assign, fromPromise, setup, stateIn, type OutputFrom } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import { app, type TransactionRow } from '#lib/schema.js'
import { normalizedName } from '#lib/domain/names.js'
import { appTransactionSchema } from '#lib/validation/transactions.js'
import { appTagSchema } from '#lib/validation/tags.js'
import type { AppTransaction } from '#lib/domain/transaction.js'
import type {
	FormChildEvent,
	FormInterruption,
	FormOperationInput,
	FormOperationResult,
	FormSettlement
} from '#lib/form-contract.js'
import type {
	TransactionEntryObservation,
	TransactionEntryScope,
	TransactionEntryReason
} from '#lib/transaction-entry-contract.js'

export type TransactionEditDb = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
type Input = FormOperationInput<AppTransaction, TransactionEntryScope, TransactionEntryObservation>
type Result = FormOperationResult<void, TransactionEntryReason>
type Transaction = ReturnType<TransactionEditDb['beginTransaction']>
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing edit resource')
	return value
}
const validate = fromPromise(({ input }: { input: AppTransaction }) =>
	Promise.resolve(appTransactionSchema.safeParse(input))
)
const open = fromPromise(({ input }: { input: TransactionEditDb }) =>
	Promise.resolve(input.beginTransaction())
)
const readTransaction = fromPromise(({ input }: { input: { tx: Transaction; id: string } }) =>
	input.tx.all(app.transactions.where({ id: input.id }))
)
function settledRead<T>(result: PromiseSettledResult<T>): T {
	if (result.status === 'rejected') throw result.reason
	return result.value
}
const readRelationships = fromPromise(
	async ({ input }: { input: { tx: Transaction; id: string; values: AppTransaction } }) => {
		// Retain every issued read, including when another query throws or rejects.
		const [links, tags, details] = await Promise.allSettled([
			Promise.resolve().then(() =>
				input.tx.all(app.transactionTags.where({ transactionId: input.id }))
			),
			Promise.resolve().then(() =>
				input.tx.all(
					app.tags.where({ organizationId: input.values.organizationId, kind: input.values.kind })
				)
			),
			Promise.resolve().then(() =>
				input.tx.all(app.checkDetails.where({ transactionId: input.id }))
			)
		])
		return { links: settledRead(links), tags: settledRead(tags), details: settledRead(details) }
	}
)
type Relationships = OutputFrom<typeof readRelationships>
function editable(existing: TransactionRow | undefined, values: AppTransaction) {
	return (
		existing !== undefined &&
		existing.organizationId === values.organizationId &&
		existing.source === values.source.source &&
		(values.source.source !== 'simplefin' || existing.externalId === values.source.externalId) &&
		existing.kind === values.kind &&
		(existing.paymentMethod !== 'check' || existing.accountId === values.accountId) &&
		('paymentMethod' in values && values.paymentMethod === 'check') ===
			(existing.paymentMethod === 'check')
	)
}
function compatibleDetails(
	existing: TransactionRow,
	values: AppTransaction,
	details: Relationships['details']
) {
	return 'paymentMethod' in values && values.paymentMethod === 'check'
		? details.length === 1 && details[0]?.id === existing.checkDetailsId
		: details.length === 0
}
// Pure reconciliation. All mutation choices and generated tag IDs precede staging.
function planEdit(
	id: string,
	existing: TransactionRow,
	values: AppTransaction,
	relationships: Relationships
) {
	const tags = relationships.tags.filter(
		(tag) => tag.organizationId === values.organizationId && tag.kind === values.kind
	)
	const byId = new Map(tags.map((tag) => [tag.id, tag]))
	const requestedNames = new Set((values.tags ?? []).map(normalizedName))
	const retainedNames = new Set(
		relationships.links.flatMap((link) => {
			const tag = byId.get(link.tagId)
			return tag && requestedNames.has(normalizedName(tag.name)) ? [normalizedName(tag.name)] : []
		})
	)
	const remove = relationships.links
		.filter((link) => {
			const tag = byId.get(link.tagId)
			// Missing historical rows cannot safely be interpreted as an assignment removal.
			return tag !== undefined && !requestedNames.has(normalizedName(tag.name))
		})
		.map((link) => link.id)
	const names = (values.tags ?? []).filter((name) => !retainedNames.has(normalizedName(name)))
	const active = tags.filter((tag) => !tag.archivedAt)
	if (
		names.some(
			(name) => active.filter((tag) => normalizedName(tag.name) === normalizedName(name)).length > 1
		)
	)
		return { kind: 'ambiguous' } satisfies { kind: 'ambiguous' }
	const additions = names.map((name) => {
		const tag = active.find((tag) => normalizedName(tag.name) === normalizedName(name))
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
	const row = {
		accountId: values.accountId,
		categoryId: values.categoryId,
		amountMinor: values.money.amountMinor,
		currency: values.money.currency,
		bookedOn: values.bookedOn,
		description: values.description ?? null,
		memo: values.memo || null,
		paymentMethod: 'paymentMethod' in values ? values.paymentMethod : null,
		checkDetailsId:
			'paymentMethod' in values && values.paymentMethod === 'check' ? existing.checkDetailsId : null
	}
	const check =
		'paymentMethod' in values && values.paymentMethod === 'check'
			? {
					id: required(relationships.details[0]).id,
					values: {
						organizationId: values.organizationId,
						accountId: values.accountId,
						checkNumber: values.checkDetails.checkNumber,
						checkDate: values.checkDetails.checkDate
					}
				}
			: undefined
	return {
		kind: 'planned',
		id,
		organizationId: values.organizationId,
		row,
		check,
		remove,
		additions
	} satisfies {
		kind: 'planned'
		id: string
		organizationId: string
		row: unknown
		check: unknown
		remove: string[]
		additions: unknown
	}
}
type Plan = Extract<ReturnType<typeof planEdit>, { kind: 'planned' }>
const plan = fromPromise(
	({
		input
	}: {
		input: {
			id: string
			existing: TransactionRow
			values: AppTransaction
			relationships: Relationships
		}
	}) => Promise.resolve(planEdit(input.id, input.existing, input.values, input.relationships))
)
const stage = fromPromise(async ({ input }: { input: { tx: Transaction; plan: Plan } }) => {
	const { tx, plan } = input
	tx.update(app.transactions, plan.id, plan.row)
	for (const id of plan.remove) tx.delete(app.transactionTags, id)
	if (plan.check) tx.update(app.checkDetails, plan.check.id, plan.check.values)
	for (const tag of plan.additions) {
		if (tag.values) tx.insert(app.tags, tag.values, { id: tag.id })
		tx.insert(app.transactionTags, {
			organizationId: plan.organizationId,
			transactionId: plan.id,
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
	existing: TransactionRow | undefined
	relationships: Relationships | undefined
	plan: Plan | undefined
	handle: OutputFrom<typeof commit> | undefined
	settlement: FormSettlement
	result: Result | undefined
}
function transactionId(context: Context) {
	const id = context.input?.request.scope.transactionId
	if (!id) throw new Error('Missing edit transaction ID')
	return id
}
const actors = {
	validate,
	open,
	readTransaction,
	readRelationships,
	plan,
	stage,
	commit,
	settle,
	rollback
}

/** Owns one atomic edit transaction through rollback or actual commit settlement. */
export function createTransactionEditPersistenceMachine(db: TransactionEditDb) {
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
	const clear = model.assign({
		input: undefined,
		values: undefined,
		tx: undefined,
		existing: undefined,
		relationships: undefined,
		plan: undefined,
		handle: undefined
	})
	const terminal = (outcome: 'succeeded' | 'failed' | FormInterruption) =>
		model.createStateConfig({
			type: 'final',
			entry: [
				model.assign({
					result: ({ context }): Result => {
						if (outcome === 'succeeded')
							return { outcome, value: undefined, settlement: 'locallyPersisted' }
						if (outcome === 'failed')
							return { outcome, code: 'operationFailed', settlement: context.settlement }
						return { outcome, settlement: context.settlement }
					}
				}),
				clear
			]
		})
	return model.createMachine({
		id: 'transaction-edit-persistence',
		initial: 'running',
		context: ({ input }) => ({
			input,
			values: undefined,
			tx: undefined,
			existing: undefined,
			relationships: undefined,
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
								id: 'edit-failure',
								always: [
									{ guard: 'closing', target: '#transaction-edit-persistence.closed' },
									{ guard: 'invalidated', target: '#transaction-edit-persistence.scopeChanged' },
									{ guard: 'cancelling', target: '#transaction-edit-persistence.cancelled' },
									{ target: '#transaction-edit-persistence.failed' }
								]
							},
							finishingSuccess: {
								id: 'edit-success',
								always: [
									{ guard: 'closing', target: '#transaction-edit-persistence.closed' },
									{ guard: 'invalidated', target: '#transaction-edit-persistence.scopeChanged' },
									{ guard: 'cancelling', target: '#transaction-edit-persistence.cancelled' },
									{ target: '#transaction-edit-persistence.succeeded' }
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
										{ target: '#edit-failure' }
									],
									onError: '#edit-failure'
								}
							},
							beforeOpen: {
								always: [
									{ guard: 'interrupted', target: '#edit-failure' },
									{
										guard: ({ context }) => Boolean(context.input?.request.scope.transactionId),
										target: 'opening'
									},
									{ target: '#edit-failure' }
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
									onError: '#edit-failure'
								}
							},
							beforeRead: gate('readingTransaction'),
							readingTransaction: {
								invoke: {
									src: 'readTransaction',
									input: ({ context }) => ({
										tx: required(context.tx),
										id: transactionId(context)
									}),
									onDone: {
										target: 'checkingEligibility',
										actions: assign({ existing: ({ event }) => event.output[0] })
									},
									onError: 'rollingBack'
								}
							},
							checkingEligibility: {
								always: [
									{ guard: 'interrupted', target: 'rollingBack' },
									{
										guard: ({ context }) => editable(context.existing, required(context.values)),
										target: 'readingRelationships'
									},
									{ target: 'rollingBack' }
								]
							},
							readingRelationships: {
								invoke: {
									src: 'readRelationships',
									input: ({ context }) => ({
										tx: required(context.tx),
										id: transactionId(context),
										values: required(context.values)
									}),
									onDone: {
										target: 'checkingDetails',
										actions: assign({ relationships: ({ event }) => event.output })
									},
									onError: 'rollingBack'
								}
							},
							checkingDetails: {
								always: [
									{ guard: 'interrupted', target: 'rollingBack' },
									{
										guard: ({ context }) =>
											compatibleDetails(
												required(context.existing),
												required(context.values),
												required(context.relationships).details
											),
										target: 'planning'
									},
									{ target: 'rollingBack' }
								]
							},
							planning: {
								invoke: {
									src: 'plan',
									input: ({ context }) => ({
										id: transactionId(context),
										existing: required(context.existing),
										values: required(context.values),
										relationships: required(context.relationships)
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
										target: '#edit-success',
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
										target: '#edit-failure',
										actions: assign({
											settlement: ({ context, event }) =>
												event.output && context.settlement === 'notStarted' ? 'rejected' : 'unknown'
										})
									},
									onError: {
										target: '#edit-failure',
										actions: assign({ settlement: 'unknown' })
									}
								}
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
