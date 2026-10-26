import { EXPENSE, INCOME } from '#lib/domain/transaction-kind.js'
import { canWriteAccount } from '#lib/domain/organization-permissions.js'
import { findInternalTransferCounterparts } from '#lib/domain/internal-transfer.js'
import { assign, fromPromise, setup, stateIn, type OutputFrom } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import {
	app,
	type InternalTransfer,
	type OrganizationMember,
	type TransactionRow
} from '#lib/schema.js'
import { createJazzTransactionActors } from './jazz-transaction-actors.js'

type LocalWrite = {
	txId: Promise<string>
	wait(options: { tier: 'local' }): Promise<void>
}
type JazzTransaction = ReturnType<ReturnType<typeof getDb>['beginTransaction']>
type Tx = Pick<JazzTransaction, 'one' | 'all' | 'insert' | 'update' | 'delete' | 'rollback'> & {
	commit(): LocalWrite
}
type Db = { beginTransaction(): Tx }
type TransferWrite = LocalWrite & { txId: Promise<string> }
type UnlinkDb = Pick<ReturnType<typeof getDb>, 'one' | 'all'> & {
	transaction(callback: (tx: Pick<JazzTransaction, 'update'>) => void): Promise<TransferWrite>
	delete(table: typeof app.internalTransfers, id: string): TransferWrite
}
type Grant = { accountId: string; access: 'read' | 'write' }
export type TransferWriteTracking = {
	transactionId: string
	operation: 'create' | 'link' | 'unlink'
	transferId: string
}
type TrackTransferWrite = (write: TransferWriteTracking) => void
export type InternalTransferLinkInput = {
	db: Db
	organizationId: string
	identityId: string
	expenseTransactionId: string
	incomeTransactionId: string
	trackWrite: TrackTransferWrite
}
export type InternalTransferLinkEvent = { type: 'CANCEL' } | { type: 'SHUTDOWN' }
export type InternalTransferLinkResult =
	| { outcome: 'succeeded'; transferId: string; settlement: 'locallyPersisted' }
	| {
			outcome: 'cancelled' | 'closed' | 'denied' | 'incompatible' | 'alreadyLinked' | 'unavailable'
			settlement: 'notStarted' | 'unresolved'
			phase?: 'commit' | 'localSettlement'
			error?: unknown
	  }

export type InternalTransferUnlinkResult =
	| { outcome: 'succeeded'; transferId: string; settlement: 'locallyPersisted' }
	| {
			outcome: 'recoveryRequired'
			transferId: string
			settlement: 'locallyPersisted' | 'unresolved'
			error?: unknown
	  }
	| {
			outcome: 'cancelled' | 'closed' | 'denied' | 'incompatible' | 'unavailable'
			settlement: 'notStarted' | 'unresolved'
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
	(db: Db) => db.beginTransaction(),
	(write: ReturnType<Tx['commit']>) => write.wait({ tier: 'local' })
)
const { open, commit, settle, rollback } = transactionActors
const identifyTransferWrite = fromPromise(({ input }: { input: TransferWrite }) => input.txId)
const read = fromPromise(
	async ({
		input
	}: {
		input: { tx: Tx; request: InternalTransferLinkInput }
	}): Promise<Records> => {
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

function assess(records: Records, request: InternalTransferLinkInput): Assessment {
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

export type InternalTransferUnlinkInput = {
	db: UnlinkDb
	organizationId: string
	identityId: string
	transferId: string
	expenseTransactionId: string
	incomeTransactionId: string
	trackWrite: TrackTransferWrite
}
type UnlinkRecords = {
	transfer: InternalTransfer | null
	expense: Endpoint | null
	income: Endpoint | null
	membership: OrganizationMember | null
	grants: Grant[]
}
type UnlinkAssessment =
	| {
			outcome: 'eligible'
			state: 'linked' | 'pending'
			transfer: InternalTransfer
			expense: Endpoint
			income: Endpoint
	  }
	| { outcome: 'denied' | 'incompatible' | 'unavailable' }
type UnlinkContext = {
	request: InternalTransferUnlinkInput
	records: UnlinkRecords | undefined
	assessment: UnlinkAssessment | undefined
	write: TransferWrite | undefined
	result: InternalTransferUnlinkResult | undefined
}
type EligibleUnlink = Extract<UnlinkAssessment, { outcome: 'eligible' }>

function eligibleUnlink(value: UnlinkAssessment | undefined): EligibleUnlink {
	if (value?.outcome !== 'eligible') throw new Error('Transfer unlink was not eligible')
	return value
}

const readUnlink = fromPromise(
	async ({ input }: { input: InternalTransferUnlinkInput }): Promise<UnlinkRecords> => {
		const [transfer, expense, income, membership, grants] = await Promise.all([
			input.db.one(app.internalTransfers.where({ id: input.transferId })),
			input.db.one(app.transactions.where({ id: input.expenseTransactionId })),
			input.db.one(app.transactions.where({ id: input.incomeTransactionId })),
			input.db.one(
				app.organizationMembers.where({
					organizationId: input.organizationId,
					userId: input.identityId
				})
			),
			input.db.all(
				app.accountMemberships.where({
					organizationId: input.organizationId,
					userId: input.identityId
				})
			)
		])
		return {
			transfer,
			expense,
			income,
			membership,
			grants: grants.map(({ accountId, access }) => ({ accountId, access }))
		}
	}
)

function assessUnlink(
	records: UnlinkRecords,
	request: InternalTransferUnlinkInput
): UnlinkAssessment {
	const { transfer, expense, income, membership, grants } = records
	if (!transfer) return { outcome: 'unavailable' }
	if (transfer.organizationId !== request.organizationId) return { outcome: 'incompatible' }
	if (
		!expense ||
		!income ||
		expense.id !== transfer.expenseTransactionId ||
		income.id !== transfer.incomeTransactionId ||
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
	const linked =
		expense.internalTransferId === transfer.id && income.internalTransferId === transfer.id
	const pending = expense.internalTransferId == null && income.internalTransferId == null
	if (!linked && !pending) return { outcome: 'incompatible' }
	return { outcome: 'eligible', state: pending ? 'pending' : 'linked', transfer, expense, income }
}

const clearUnlinkMarkers = fromPromise(
	({
		input
	}: {
		input: { request: InternalTransferUnlinkInput; assessment: EligibleUnlink }
	}): Promise<TransferWrite> => {
		return input.request.db.transaction((tx) => {
			tx.update(app.transactions, input.assessment.expense.id, { internalTransferId: null })
			tx.update(app.transactions, input.assessment.income.id, { internalTransferId: null })
		})
	}
)
const deleteUnlinkRelationship = fromPromise(
	({
		input
	}: {
		input: { request: InternalTransferUnlinkInput; assessment: EligibleUnlink }
	}): Promise<TransferWrite> =>
		Promise.resolve(input.request.db.delete(app.internalTransfers, input.assessment.transfer.id))
)
const settleUnlinkWrite = fromPromise(({ input }: { input: TransferWrite }) =>
	input.wait({ tier: 'local' })
)

/** Owns ordered local-first unlink writes and exposes partial completion for recovery. */
export const internalTransferUnlinkMachine = setup<
	UnlinkContext,
	InternalTransferLinkEvent,
	{
		read: typeof readUnlink
		clearMarkers: typeof clearUnlinkMarkers
		deleteRelationship: typeof deleteUnlinkRelationship
		identifyTransferWrite: typeof identifyTransferWrite
		settleWrite: typeof settleUnlinkWrite
	},
	{},
	{},
	{ closing: undefined; cancelling: undefined },
	never,
	string,
	InternalTransferUnlinkInput,
	InternalTransferUnlinkResult
>({
	actors: {
		read: readUnlink,
		clearMarkers: clearUnlinkMarkers,
		deleteRelationship: deleteUnlinkRelationship,
		identifyTransferWrite,
		settleWrite: settleUnlinkWrite
	},
	guards: {
		closing: stateIn({ running: { control: 'closing' } }),
		cancelling: stateIn({ running: { control: 'cancelling' } })
	}
}).createMachine({
	id: 'internal-transfer-unlink',
	context: ({ input }) => ({
		request: input,
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
					initial: 'reading',
					states: {
						reading: {
							invoke: {
								src: 'read',
								input: ({ context }) => context.request,
								onDone: {
									target: 'checkingAfterRead',
									actions: assign({ records: ({ event }) => event.output })
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
						checkingAfterRead: {
							always: [
								{
									guard: 'closing',
									target: 'finishing',
									actions: assign({ result: { outcome: 'closed', settlement: 'notStarted' } })
								},
								{
									guard: 'cancelling',
									target: 'finishing',
									actions: assign({ result: { outcome: 'cancelled', settlement: 'notStarted' } })
								},
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
								{
									guard: 'closing',
									target: 'finishing',
									actions: assign({ result: { outcome: 'closed', settlement: 'notStarted' } })
								},
								{
									guard: 'cancelling',
									target: 'finishing',
									actions: assign({ result: { outcome: 'cancelled', settlement: 'notStarted' } })
								},
								{
									guard: ({ context }) => required(context.assessment).outcome !== 'eligible',
									target: 'finishing',
									actions: assign({
										result: ({ context }): InternalTransferUnlinkResult => {
											const assessment = required(context.assessment)
											return assessment.outcome === 'eligible'
												? { outcome: 'unavailable', settlement: 'notStarted' }
												: { outcome: assessment.outcome, settlement: 'notStarted' }
										}
									})
								},
								{
									guard: ({ context }) =>
										context.assessment?.outcome === 'eligible' &&
										context.assessment.state === 'pending',
									target: 'deleting'
								},
								{ target: 'clearingMarkers' }
							]
						},
						clearingMarkers: {
							invoke: {
								src: 'clearMarkers',
								input: ({ context }) => ({
									request: context.request,
									assessment: eligibleUnlink(context.assessment)
								}),
								onDone: {
									target: 'identifyingClearWrite',
									actions: assign({ write: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ context, event }): InternalTransferUnlinkResult => ({
											outcome: 'recoveryRequired',
											transferId: eligibleUnlink(context.assessment).transfer.id,
											settlement: 'unresolved',
											error: event.error
										})
									})
								}
							}
						},
						identifyingClearWrite: {
							invoke: {
								src: 'identifyTransferWrite',
								input: ({ context }) => required(context.write),
								onDone: {
									target: 'settlingClearWrite',
									actions: ({ context, event }) =>
										context.request.trackWrite({
											transactionId: event.output,
											operation: 'unlink',
											transferId: eligibleUnlink(context.assessment).transfer.id
										})
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ context, event }): InternalTransferUnlinkResult => ({
											outcome: 'recoveryRequired',
											transferId: eligibleUnlink(context.assessment).transfer.id,
											settlement: 'unresolved',
											error: event.error
										})
									})
								}
							}
						},
						settlingClearWrite: {
							invoke: {
								src: 'settleWrite',
								input: ({ context }) => required(context.write),
								onDone: { target: 'checkingAfterClear' },
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ context, event }): InternalTransferUnlinkResult => ({
											outcome: 'recoveryRequired',
											transferId: eligibleUnlink(context.assessment).transfer.id,
											settlement: 'unresolved',
											error: event.error
										})
									})
								}
							}
						},
						checkingAfterClear: {
							always: [
								{
									guard: 'closing',
									target: 'finishing',
									actions: assign({
										result: ({ context }): InternalTransferUnlinkResult => ({
											outcome: 'recoveryRequired',
											transferId: eligibleUnlink(context.assessment).transfer.id,
											settlement: 'locallyPersisted'
										})
									})
								},
								{
									guard: 'cancelling',
									target: 'finishing',
									actions: assign({
										result: ({ context }): InternalTransferUnlinkResult => ({
											outcome: 'recoveryRequired',
											transferId: eligibleUnlink(context.assessment).transfer.id,
											settlement: 'locallyPersisted'
										})
									})
								},
								{ target: 'deleting' }
							]
						},
						deleting: {
							invoke: {
								src: 'deleteRelationship',
								input: ({ context }) => ({
									request: context.request,
									assessment: eligibleUnlink(context.assessment)
								}),
								onDone: {
									target: 'identifyingDeleteWrite',
									actions: assign({ write: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ context, event }): InternalTransferUnlinkResult => ({
											outcome: 'recoveryRequired',
											transferId: eligibleUnlink(context.assessment).transfer.id,
											settlement: 'locallyPersisted',
											error: event.error
										})
									})
								}
							}
						},
						identifyingDeleteWrite: {
							invoke: {
								src: 'identifyTransferWrite',
								input: ({ context }) => required(context.write),
								onDone: {
									target: 'settlingDeleteWrite',
									actions: ({ context, event }) =>
										context.request.trackWrite({
											transactionId: event.output,
											operation: 'unlink',
											transferId: eligibleUnlink(context.assessment).transfer.id
										})
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ context, event }): InternalTransferUnlinkResult => ({
											outcome: 'recoveryRequired',
											transferId: eligibleUnlink(context.assessment).transfer.id,
											settlement: 'locallyPersisted',
											error: event.error
										})
									})
								}
							}
						},
						settlingDeleteWrite: {
							invoke: {
								src: 'settleWrite',
								input: ({ context }) => required(context.write),
								onDone: {
									target: 'finishing',
									actions: assign({
										result: ({ context }): InternalTransferUnlinkResult => ({
											outcome: 'succeeded',
											transferId: eligibleUnlink(context.assessment).transfer.id,
											settlement: 'locallyPersisted'
										})
									})
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ context, event }): InternalTransferUnlinkResult => ({
											outcome: 'recoveryRequired',
											transferId: eligibleUnlink(context.assessment).transfer.id,
											settlement: 'locallyPersisted',
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
	request: InternalTransferLinkInput
	tx: Tx | undefined
	records: Records | undefined
	assessment: Assessment | undefined
	transferId: string | undefined
	write: OutputFrom<typeof commit> | undefined
	result: InternalTransferLinkResult | undefined
}

/** Owns one mergeable Jazz transaction from endpoint read through local persistence. */
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
		identifyTransferWrite: typeof identifyTransferWrite
	},
	{},
	{},
	{ closing: undefined; cancelling: undefined },
	never,
	string,
	InternalTransferLinkInput,
	InternalTransferLinkResult
>({
	actors: { open, read, stage, commit, settle, rollback, identifyTransferWrite },
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
											phase: 'commit',
											error: event.error
										})
									})
								}
							}
						},
						checkingAfterCommit: {
							always: {
								target: 'identifyingWrite',
								actions: assign({
									result: ({ context }): InternalTransferLinkResult => ({
										outcome: 'unavailable',
										settlement: 'unresolved',
										error: undefined
									})
								})
							}
						},
						identifyingWrite: {
							invoke: {
								src: 'identifyTransferWrite',
								input: ({ context }) => required(context.write),
								onDone: {
									target: 'settling',
									actions: ({ context, event }) =>
										context.request.trackWrite({
											transactionId: event.output,
											operation: 'link',
											transferId: required(context.transferId)
										})
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): InternalTransferLinkResult => ({
											outcome: 'unavailable',
											settlement: 'unresolved',
											phase: 'commit',
											error: event.error
										})
									})
								}
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
											settlement: 'locallyPersisted'
										})
									})
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): InternalTransferLinkResult => ({
											outcome: 'unavailable',
											settlement: 'unresolved',
											phase: 'localSettlement',
											error: event.error
										})
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
