import { EXPENSE, INCOME } from '#lib/domain/transaction-kind.js'
import { canWriteAccount } from '#lib/domain/organization-permissions.js'
import { findInternalTransferCounterparts } from '#lib/domain/internal-transfer.js'
import { assign, fromPromise, setup, stateIn, type OutputFrom } from 'xstate'
import { PersistedWriteRejectedError } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import {
	app,
	type InternalTransfer,
	type OrganizationMember,
	type TransactionRow
} from '#lib/schema.js'
import { createJazzTransactionActors } from './jazz-transaction-actors.js'

type JazzTransaction = ReturnType<ReturnType<typeof getDb>['beginExclusiveTransaction']>
type Tx = Pick<JazzTransaction, 'one' | 'all' | 'insert' | 'update' | 'delete' | 'rollback'> & {
	commit(): { wait(): Promise<void> }
}
type Db = { beginExclusiveTransaction(): Tx }
type Grant = { accountId: string; access: 'read' | 'write' }
type Input = {
	db: Db
	organizationId: string
	identityId: string
	expenseTransactionId: string
	incomeTransactionId: string
}
export type InternalTransferLinkEvent = { type: 'CANCEL' } | { type: 'SHUTDOWN' }
export type InternalTransferLinkResult =
	| { outcome: 'succeeded'; transferId: string; settlement: 'authoritativelyAccepted' }
	| {
			outcome: 'cancelled' | 'closed' | 'denied' | 'incompatible' | 'alreadyLinked' | 'unavailable'
			settlement: 'notStarted' | 'authoritativelyRejected' | 'unresolved'
			error?: unknown
	  }

export type InternalTransferUnlinkResult =
	| { outcome: 'succeeded'; transferId: string; settlement: 'authoritativelyAccepted' }
	| {
			outcome: 'cancelled' | 'closed' | 'denied' | 'incompatible' | 'unavailable'
			settlement: 'notStarted' | 'authoritativelyRejected' | 'unresolved'
			error?: unknown
	  }

type Endpoint = Pick<
	TransactionRow,
	| 'id'
	| 'organizationId'
	| 'accountId'
	| 'kind'
	| 'amountMinor'
	| 'currency'
	| 'bookedOn'
	| 'internalTransferId'
>
type Records = {
	expense: Endpoint | null
	income: Endpoint | null
	membership: OrganizationMember | null
	grants: Grant[]
	links: InternalTransfer[]
}
type Assessment =
	| { outcome: 'eligible'; expense: Endpoint; income: Endpoint }
	| { outcome: 'denied' | 'incompatible' | 'alreadyLinked' | 'unavailable' }

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing internal transfer transaction resource')
	return value
}
function eligibleAssessment(
	value: Assessment | undefined
): Extract<Assessment, { outcome: 'eligible' }> {
	if (value?.outcome !== 'eligible') throw new Error('Transfer link was not eligible')
	return value
}

const transactionActors = createJazzTransactionActors(
	(db: Db) => db.beginExclusiveTransaction(),
	(write: ReturnType<Tx['commit']>) => write.wait()
)
const { open, commit, settle, rollback } = transactionActors
const read = fromPromise(
	async ({ input }: { input: { tx: Tx; request: Input } }): Promise<Records> => {
		const { tx, request } = input
		const [
			expense,
			income,
			membership,
			grants,
			expenseOutgoing,
			expenseIncoming,
			incomeOutgoing,
			incomeIncoming
		] = await Promise.all([
			tx.one(app.transactions.where({ id: request.expenseTransactionId })),
			tx.one(app.transactions.where({ id: request.incomeTransactionId })),
			tx.one(
				app.organizationMembers.where({
					organizationId: request.organizationId,
					userId: request.identityId
				})
			),
			tx.all(
				app.accountMemberships.where({
					organizationId: request.organizationId,
					userId: request.identityId
				})
			),
			tx.all(app.internalTransfers.where({ expenseTransactionId: request.expenseTransactionId })),
			tx.all(app.internalTransfers.where({ incomeTransactionId: request.expenseTransactionId })),
			tx.all(app.internalTransfers.where({ expenseTransactionId: request.incomeTransactionId })),
			tx.all(app.internalTransfers.where({ incomeTransactionId: request.incomeTransactionId }))
		])
		return {
			expense,
			income,
			membership,
			grants: grants.map(({ accountId, access }) => ({ accountId, access })),
			links: [...expenseOutgoing, ...expenseIncoming, ...incomeOutgoing, ...incomeIncoming]
		}
	}
)

function assess(records: Records, request: Input): Assessment {
	const { expense, income, membership, grants, links } = records
	if (!expense || !income) return { outcome: 'unavailable' }
	if (links.length > 0 || expense.internalTransferId || income.internalTransferId)
		return { outcome: 'alreadyLinked' }
	if (
		expense.organizationId !== request.organizationId ||
		income.organizationId !== request.organizationId ||
		expense.kind !== EXPENSE ||
		income.kind !== INCOME
	)
		return { outcome: 'incompatible' }
	if (
		!canWriteAccount(membership, request.organizationId, expense.accountId, grants) ||
		!canWriteAccount(membership, request.organizationId, income.accountId, grants)
	)
		return { outcome: 'denied' }
	const candidates = findInternalTransferCounterparts(expense, [income], new Set())
	return candidates.length === 1
		? { outcome: 'eligible', expense, income }
		: { outcome: 'incompatible' }
}

const stage = fromPromise(
	({ input }: { input: { tx: Tx; assessment: Extract<Assessment, { outcome: 'eligible' }> } }) => {
		const { tx, assessment } = input
		const transferId = crypto.randomUUID()
		tx.update(app.transactions, assessment.expense.id, { internalTransferId: transferId })
		tx.update(app.transactions, assessment.income.id, { internalTransferId: transferId })
		const transfer = tx.insert(
			app.internalTransfers,
			{
				organizationId: assessment.expense.organizationId,
				expenseTransactionId: assessment.expense.id,
				incomeTransactionId: assessment.income.id,
				expenseAccountId: assessment.expense.accountId,
				incomeAccountId: assessment.income.accountId,
				amountMinor: assessment.expense.amountMinor,
				currency: assessment.expense.currency
			},
			{ id: transferId }
		)
		return Promise.resolve(transfer.id)
	}
)

type UnlinkInput = {
	db: Db
	organizationId: string
	identityId: string
	transferId: string
}
type UnlinkRecords = {
	transfer: InternalTransfer | null
	endpoints: Endpoint[]
	membership: OrganizationMember | null
	grants: Grant[]
}
type UnlinkAssessment =
	| { outcome: 'eligible'; transfer: InternalTransfer; expense: Endpoint; income: Endpoint }
	| { outcome: 'denied' | 'incompatible' | 'unavailable' }
type UnlinkContext = {
	request: UnlinkInput
	tx: Tx | undefined
	records: UnlinkRecords | undefined
	assessment: UnlinkAssessment | undefined
	write: OutputFrom<typeof commit> | undefined
	result: InternalTransferUnlinkResult | undefined
}
type EligibleUnlink = Extract<UnlinkAssessment, { outcome: 'eligible' }>

function eligibleUnlink(value: UnlinkAssessment | undefined): EligibleUnlink {
	if (value?.outcome !== 'eligible') throw new Error('Transfer unlink was not eligible')
	return value
}

const readUnlink = fromPromise(
	async ({ input }: { input: { tx: Tx; request: UnlinkInput } }): Promise<UnlinkRecords> => {
		const { tx, request } = input
		const [transfer, endpoints, membership, grants] = await Promise.all([
			tx.one(app.internalTransfers.where({ id: request.transferId })),
			tx.all(app.transactions.where({ internalTransferId: request.transferId })),
			tx.one(
				app.organizationMembers.where({
					organizationId: request.organizationId,
					userId: request.identityId
				})
			),
			tx.all(
				app.accountMemberships.where({
					organizationId: request.organizationId,
					userId: request.identityId
				})
			)
		])
		return {
			transfer,
			endpoints,
			membership,
			grants: grants.map(({ accountId, access }) => ({ accountId, access }))
		}
	}
)

function assessUnlink(records: UnlinkRecords, request: UnlinkInput): UnlinkAssessment {
	const { transfer, endpoints, membership, grants } = records
	if (!transfer) return { outcome: 'unavailable' }
	if (transfer.organizationId !== request.organizationId) return { outcome: 'incompatible' }
	const expense = endpoints.find(({ id }) => id === transfer.expenseTransactionId)
	const income = endpoints.find(({ id }) => id === transfer.incomeTransactionId)
	if (
		!expense ||
		!income ||
		endpoints.length !== 2 ||
		expense.internalTransferId !== transfer.id ||
		income.internalTransferId !== transfer.id ||
		expense.organizationId !== request.organizationId ||
		income.organizationId !== request.organizationId ||
		expense.accountId !== transfer.expenseAccountId ||
		income.accountId !== transfer.incomeAccountId ||
		expense.kind !== EXPENSE ||
		income.kind !== INCOME ||
		expense.amountMinor !== transfer.amountMinor ||
		income.amountMinor !== transfer.amountMinor ||
		expense.currency !== transfer.currency ||
		income.currency !== transfer.currency ||
		expense.accountId === income.accountId
	)
		return { outcome: 'incompatible' }
	if (
		!canWriteAccount(membership, request.organizationId, expense.accountId, grants) ||
		!canWriteAccount(membership, request.organizationId, income.accountId, grants)
	)
		return { outcome: 'denied' }
	return { outcome: 'eligible', transfer, expense, income }
}

const stageUnlink = fromPromise(({ input }: { input: { tx: Tx; assessment: EligibleUnlink } }) => {
	const { tx, assessment } = input
	tx.update(app.transactions, assessment.expense.id, { internalTransferId: null })
	tx.update(app.transactions, assessment.income.id, { internalTransferId: null })
	tx.delete(app.internalTransfers, assessment.transfer.id)
	return Promise.resolve(assessment.transfer.id)
})

/** Owns one exclusive Jazz transaction while removing a transfer relationship. */
export const internalTransferUnlinkMachine = setup<
	UnlinkContext,
	InternalTransferLinkEvent,
	{
		open: typeof transactionActors.open
		read: typeof readUnlink
		stage: typeof stageUnlink
		commit: typeof transactionActors.commit
		settle: typeof transactionActors.settle
		rollback: typeof transactionActors.rollback
	},
	{},
	{},
	{ closing: undefined; cancelling: undefined },
	never,
	string,
	UnlinkInput,
	InternalTransferUnlinkResult
>({
	actors: { open, read: readUnlink, stage: stageUnlink, commit, settle, rollback },
	guards: {
		closing: stateIn({ running: { control: 'closing' } }),
		cancelling: stateIn({ running: { control: 'cancelling' } })
	}
}).createMachine({
	id: 'internal-transfer-unlink',
	context: ({ input }) => ({
		request: input,
		tx: undefined,
		records: undefined,
		assessment: undefined,
		write: undefined,
		result: undefined
	}),
	initial: 'running',
	output: ({ context }) => required(context.result),
	states: {
		running: {
			type: 'parallel',
			states: {
				control: {
					initial: 'active',
					states: {
						active: { on: { CANCEL: 'cancelling', SHUTDOWN: 'closing' } },
						cancelling: { on: { CANCEL: {}, SHUTDOWN: 'closing' } },
						closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
					}
				},
				work: {
					initial: 'opening',
					states: {
						opening: {
							invoke: {
								src: 'open',
								input: ({ context }) => context.request.db,
								onDone: {
									target: 'checkingAfterOpen',
									actions: assign({ tx: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): InternalTransferUnlinkResult => ({
											outcome: 'unavailable',
											settlement: 'notStarted',
											error: event.error
										})
									})
								}
							}
						},
						checkingAfterOpen: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{ target: 'reading' }
							]
						},
						reading: {
							invoke: {
								src: 'read',
								input: ({ context }) => ({ tx: required(context.tx), request: context.request }),
								onDone: {
									target: 'checkingAfterRead',
									actions: assign({ records: ({ event }) => event.output })
								},
								onError: {
									target: 'rollingBack',
									actions: assign({
										result: ({ event }): InternalTransferUnlinkResult => ({
											outcome: 'unavailable',
											settlement: 'notStarted',
											error: event.error
										})
									})
								}
							}
						},
						checkingAfterRead: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{ target: 'assessing' }
							]
						},
						assessing: {
							always: {
								target: 'checkingAssessment',
								actions: assign({
									assessment: ({ context }) =>
										assessUnlink(required(context.records), context.request)
								})
							}
						},
						checkingAssessment: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{
									guard: ({ context }) => required(context.assessment).outcome !== 'eligible',
									target: 'rollingBack',
									actions: assign({
										result: ({ context }): InternalTransferUnlinkResult => {
											const assessment = required(context.assessment)
											return assessment.outcome === 'eligible'
												? { outcome: 'unavailable', settlement: 'notStarted' }
												: { outcome: assessment.outcome, settlement: 'notStarted' }
										}
									})
								},
								{ target: 'staging' }
							]
						},
						staging: {
							invoke: {
								src: 'stage',
								input: ({ context }) => ({
									tx: required(context.tx),
									assessment: eligibleUnlink(context.assessment)
								}),
								onDone: { target: 'checkingAfterStage' },
								onError: {
									target: 'rollingBack',
									actions: assign({
										result: ({ event }): InternalTransferUnlinkResult => ({
											outcome: 'unavailable',
											settlement: 'notStarted',
											error: event.error
										})
									})
								}
							}
						},
						checkingAfterStage: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{ target: 'committing' }
							]
						},
						committing: {
							invoke: {
								src: 'commit',
								input: ({ context }) => required(context.tx),
								onDone: {
									target: 'checkingAfterCommit',
									actions: assign({ write: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): InternalTransferUnlinkResult => ({
											outcome: 'unavailable',
											settlement: 'unresolved',
											error: event.error
										})
									})
								}
							}
						},
						checkingAfterCommit: {
							always: {
								target: 'settling',
								actions: assign({
									result: (): InternalTransferUnlinkResult => ({
										outcome: 'unavailable',
										settlement: 'unresolved'
									})
								})
							}
						},
						settling: {
							invoke: {
								src: 'settle',
								input: ({ context }) => required(context.write),
								onDone: {
									target: 'finishing',
									actions: assign({
										result: ({ context }): InternalTransferUnlinkResult => ({
											outcome: 'succeeded',
											transferId: eligibleUnlink(context.assessment).transfer.id,
											settlement: 'authoritativelyAccepted'
										})
									})
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): InternalTransferUnlinkResult =>
											event.error instanceof PersistedWriteRejectedError
												? {
														outcome: 'denied',
														settlement: 'authoritativelyRejected',
														error: event.error
													}
												: {
														outcome: 'unavailable',
														settlement: 'unresolved',
														error: event.error
													}
									})
								}
							}
						},
						rollingBack: {
							invoke: {
								src: 'rollback',
								input: ({ context }) => required(context.tx),
								onDone: [
									{
										guard: 'closing',
										target: 'finishing',
										actions: assign({
											result: ({ context }): InternalTransferUnlinkResult =>
												context.result ?? { outcome: 'closed', settlement: 'notStarted' }
										})
									},
									{
										guard: 'cancelling',
										target: 'finishing',
										actions: assign({
											result: ({ context }): InternalTransferUnlinkResult =>
												context.result ?? { outcome: 'cancelled', settlement: 'notStarted' }
										})
									},
									{
										target: 'finishing',
										actions: assign({
											result: ({ context }): InternalTransferUnlinkResult =>
												context.result ?? { outcome: 'unavailable', settlement: 'notStarted' }
										})
									}
								],
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): InternalTransferUnlinkResult => ({
											outcome: 'unavailable',
											settlement: 'unresolved',
											error: event.error
										})
									})
								}
							}
						},
						finishing: { always: '#internal-transfer-unlink.terminal' }
					}
				}
			}
		},
		terminal: { type: 'final' }
	}
})
type Context = {
	request: Input
	tx: Tx | undefined
	records: Records | undefined
	assessment: Assessment | undefined
	transferId: string | undefined
	write: OutputFrom<typeof commit> | undefined
	result: InternalTransferLinkResult | undefined
}

/** Owns one exclusive Jazz transaction from endpoint read through authoritative settlement. */
export const internalTransferLinkMachine = setup<
	Context,
	InternalTransferLinkEvent,
	{
		open: typeof transactionActors.open
		read: typeof read
		stage: typeof stage
		commit: typeof transactionActors.commit
		settle: typeof transactionActors.settle
		rollback: typeof transactionActors.rollback
	},
	{},
	{},
	{ closing: undefined; cancelling: undefined },
	never,
	string,
	Input,
	InternalTransferLinkResult
>({
	actors: { open, read, stage, commit, settle, rollback },
	guards: {
		closing: stateIn({ running: { control: 'closing' } }),
		cancelling: stateIn({ running: { control: 'cancelling' } })
	}
}).createMachine({
	id: 'internal-transfer-link',
	context: ({ input }) => ({
		request: input,
		tx: undefined,
		records: undefined,
		assessment: undefined,
		transferId: undefined,
		write: undefined,
		result: undefined
	}),
	initial: 'running',
	output: ({ context }) => required(context.result),
	states: {
		running: {
			type: 'parallel',
			states: {
				control: {
					initial: 'active',
					states: {
						active: { on: { CANCEL: 'cancelling', SHUTDOWN: 'closing' } },
						cancelling: { on: { CANCEL: {}, SHUTDOWN: 'closing' } },
						closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
					}
				},
				work: {
					initial: 'opening',
					states: {
						opening: {
							invoke: {
								src: 'open',
								input: ({ context }) => context.request.db,
								onDone: {
									target: 'checkingAfterOpen',
									actions: assign({ tx: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): InternalTransferLinkResult => ({
											outcome: 'unavailable',
											settlement: 'notStarted',
											error: event.error
										})
									})
								}
							}
						},
						checkingAfterOpen: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{ target: 'reading' }
							]
						},
						reading: {
							invoke: {
								src: 'read',
								input: ({ context }) => ({ tx: required(context.tx), request: context.request }),
								onDone: {
									target: 'checkingAfterRead',
									actions: assign({ records: ({ event }) => event.output })
								},
								onError: {
									target: 'rollingBack',
									actions: assign({
										result: ({ event }): InternalTransferLinkResult => ({
											outcome: 'unavailable',
											settlement: 'notStarted',
											error: event.error
										})
									})
								}
							}
						},
						checkingAfterRead: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{ target: 'assessing' }
							]
						},
						assessing: {
							always: {
								target: 'checkingAssessment',
								actions: assign({
									assessment: ({ context }) => assess(required(context.records), context.request)
								})
							}
						},
						checkingAssessment: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{
									guard: ({ context }) => required(context.assessment).outcome !== 'eligible',
									target: 'rollingBack',
									actions: assign({
										result: ({ context }): InternalTransferLinkResult => {
											const assessment = required(context.assessment)
											return assessment.outcome === 'eligible'
												? { outcome: 'unavailable', settlement: 'notStarted' }
												: { outcome: assessment.outcome, settlement: 'notStarted' }
										}
									})
								},
								{ target: 'staging' }
							]
						},
						staging: {
							invoke: {
								src: 'stage',
								input: ({ context }) => ({
									tx: required(context.tx),
									assessment: eligibleAssessment(context.assessment)
								}),
								onDone: {
									target: 'checkingAfterStage',
									actions: assign({ transferId: ({ event }) => event.output })
								},
								onError: {
									target: 'rollingBack',
									actions: assign({
										result: ({ event }): InternalTransferLinkResult => ({
											outcome: 'unavailable',
											settlement: 'notStarted',
											error: event.error
										})
									})
								}
							}
						},
						checkingAfterStage: {
							always: [
								{ guard: 'closing', target: 'rollingBack' },
								{ guard: 'cancelling', target: 'rollingBack' },
								{ target: 'committing' }
							]
						},
						committing: {
							invoke: {
								src: 'commit',
								input: ({ context }) => required(context.tx),
								onDone: {
									target: 'checkingAfterCommit',
									actions: assign({ write: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): InternalTransferLinkResult => ({
											outcome: 'unavailable',
											settlement: 'unresolved',
											error: event.error
										})
									})
								}
							}
						},
						checkingAfterCommit: {
							always: {
								target: 'settling',
								actions: assign({
									result: ({ context }): InternalTransferLinkResult => ({
										outcome: 'unavailable',
										settlement: 'unresolved',
										error: undefined
									})
								})
							}
						},
						settling: {
							invoke: {
								src: 'settle',
								input: ({ context }) => required(context.write),
								onDone: {
									target: 'finishing',
									actions: assign({
										result: ({ context }): InternalTransferLinkResult => ({
											outcome: 'succeeded',
											transferId: required(context.transferId),
											settlement: 'authoritativelyAccepted'
										})
									})
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): InternalTransferLinkResult =>
											event.error instanceof PersistedWriteRejectedError
												? {
														outcome: 'denied',
														settlement: 'authoritativelyRejected',
														error: event.error
													}
												: {
														outcome: 'unavailable',
														settlement: 'unresolved',
														error: event.error
													}
									})
								}
							}
						},
						rollingBack: {
							invoke: {
								src: 'rollback',
								input: ({ context }) => required(context.tx),
								onDone: [
									{
										guard: 'closing',
										target: 'finishing',
										actions: assign({
											result: ({ context }): InternalTransferLinkResult =>
												context.result ?? { outcome: 'closed', settlement: 'notStarted' }
										})
									},
									{
										guard: 'cancelling',
										target: 'finishing',
										actions: assign({
											result: ({ context }): InternalTransferLinkResult =>
												context.result ?? { outcome: 'cancelled', settlement: 'notStarted' }
										})
									},
									{
										target: 'finishing',
										actions: assign({
											result: ({ context }): InternalTransferLinkResult =>
												context.result ?? { outcome: 'unavailable', settlement: 'notStarted' }
										})
									}
								],
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): InternalTransferLinkResult => ({
											outcome: 'unavailable',
											settlement: 'unresolved',
											error: event.error
										})
									})
								}
							}
						},
						finishing: { always: '#internal-transfer-link.terminal' }
					}
				}
			}
		},
		terminal: { type: 'final' }
	}
})
