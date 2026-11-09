import {
	and,
	assign,
	forwardTo,
	fromPromise,
	fromCallback,
	sendTo,
	raise,
	setup,
	type ActorRefFrom,
	type SnapshotFrom,
	type ActorLogic,
	type EventObject,
	type Snapshot
} from 'xstate'
import { type AccountHandle, type JazzClient } from 'jazz-tools/client'
import { createDb, type Db, type DbConfig, type Transaction, type WriteHandle } from 'jazz-tools'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/binding'
import type {
	RestoreEvent,
	RestoreInput,
	RestoreResult,
	RestoreTransactionWriter
} from 'delightful-local-first/backup/restore'
import {
	createRestoreJournalStepMachine,
	createRestoreMachine
} from 'delightful-local-first/backup/restore/workflow'
import {
	createRestoreJournalRecord,
	parseRestoreJournalRecord,
	type RestoreJournalIntent,
	type RestoreJournalRecord
} from 'delightful-local-first/backup/restore/journal'

import { PersistedWriteRejectedError } from 'jazz-tools'
import {
	restoreTransactionAccess,
	type RestoreDestinationInput,
	type RestoreDestinationResult
} from 'delightful-local-first/backup/restore'
import {
	prepareArchiveOpen,
	type ArchiveEnvelopeRequest,
	type ArchiveEnvelopeResult,
	type IntegrityCheckedArchive
} from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import { payloadLimits } from 'delightful-local-first/backup/archive'
import type { JazzSession } from 'jazz-tools/client'
import { stableUuid } from '../../domain/stable-uuid.js'
import { app } from '../../schema.js'
import { validateFinanceBackup } from '../../backup/workspace.js'
import {
	canonicalRecovery,
	digestRecovery,
	financeGraphRows,
	restorePartBytes,
	type FinanceRestoreGraph,
	type FinanceRestorePlan,
	type FinanceRestorePlanRequest
} from './workspace-restore-plan.js'
import {
	prepareFinanceRestorePlan,
	financeRestorePlanningMachine
} from './workspace-restore-plan.js'

type RestoreClient = Pick<JazzClient, 'db' | 'shutdown'>
/** One account-bound acquisition; the restore chart retains and drains its lifetime. */
async function openRestoreClient(config: DbConfig): Promise<RestoreClient> {
	const db = await createDb(config)
	return { db, shutdown: (options) => db.shutdown(options) }
}
export type FinanceRestoreDb = Pick<Db, 'all' | 'getAuthState' | 'getConfig' | 'beginTransaction'>
export type FinanceRestoreComparisonInput = {
	binding: BackupBinding
	databaseName: string
	record: RestoreJournalRecord
}
type Writer = RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>
type Custody = Parameters<Writer['retainDetached']>[0]
export type FinanceRestoreSessionAdapter<
	WriteSnapshot extends Snapshot<RestoreResult>,
	WriteEvent extends EventObject,
	ComparisonSnapshot extends Snapshot<RestoreJournalRecord | undefined>,
	ComparisonEvent extends EventObject
> = {
	machine: ActorLogic<WriteSnapshot, WriteEvent, RestoreInput>
	comparison: ActorLogic<ComparisonSnapshot, RestoreEvent, FinanceRestoreComparisonInput>
	writer: Writer
}
export type FinanceRestoreSessionResult = {
	outcome: 'complete' | 'incomplete' | 'conflict' | 'cancelled' | 'closed' | 'invalidated'
	record: RestoreJournalRecord | undefined
}
type Context = FinanceRestoreSessionResult & {
	interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
}
const restoreInterruption = (previous: Context['interruption'], event: { type: string }) =>
	previous === 'closed' || event.type === 'SHUTDOWN'
		? 'closed'
		: previous === 'invalidated' || event.type === 'INVALIDATE'
			? 'invalidated'
			: 'cancelled'
type Options = {
	account: AccountHandle
	serverUrl: string
	binding: BackupBinding
	intent: RestoreJournalIntent
	databaseName: string
	mode: 'new' | 'resume'
	/** Ownership transfer: called only after the restore client has safely closed. */
	releaseArtifacts(): void
}
const required = <Value>(value: Value | undefined): Value => {
	if (value === undefined) throw new Error('Missing restore resource')
	return value
}
/** The caller transfers artifact custody to the returned operation; start and drain it before stop. */
export function createFinanceWorkspaceRestore(
	issued: Omit<Options, 'intent' | 'releaseArtifacts'> & {
		archive: IntegrityCheckedArchive
		plan: FinanceRestorePlanRequest
		releaseFile(): void
	},
	acquireClient: (config: DbConfig) => Promise<RestoreClient> = openRestoreClient
) {
	const { archive, plan: planning, releaseFile, ...options } = issued
	const plan = planning.read()
	return createFinanceRestoreSession(
		{
			...options,
			intent: plan.intent,
			releaseArtifacts: () => {
				planning.release()
				archive.release()
				releaseFile()
			}
		},
		(db, retain) => createFinanceRestoreAdapter(db, plan, archive, retain),
		acquireClient
	)
}
/** One factory per operation owner. Send SHUTDOWN and await output before stopping its actor. */
export function createFinanceRestoreSession<
	WriteSnapshot extends Snapshot<RestoreResult>,
	WriteEvent extends EventObject,
	ComparisonSnapshot extends Snapshot<RestoreJournalRecord | undefined>,
	ComparisonEvent extends EventObject
>(
	issued: Options,
	createAdapter: (
		db: FinanceRestoreDb,
		retain: Writer['retainDetached']
	) => FinanceRestoreSessionAdapter<WriteSnapshot, WriteEvent, ComparisonSnapshot, ComparisonEvent>,
	acquireClient: (config: DbConfig) => Promise<RestoreClient> = openRestoreClient
) {
	const options = Object.freeze({ ...issued })
	const binding = Object.freeze({ ...options.binding }),
		intent = createRestoreJournalRecord(options.intent).intent
	let client: RestoreClient | undefined,
		transaction: Transaction<'mergeable'> | undefined,
		write: WriteHandle | undefined,
		transactionId: string | undefined
	const custody: Custody[] = []
	const db: FinanceRestoreDb = {
		all: (query, settings) => required(client).db.all(query, settings),
		getAuthState: () => required(client).db.getAuthState(),
		getConfig: () => required(client).db.getConfig(),
		beginTransaction: () => required(client).db.beginTransaction()
	}
	const adapter = createAdapter(db, (receipt) => custody.push(receipt))
	const checkpointWrite = (record: RestoreJournalRecord | undefined) => {
		const checkpoint = record?.checkpoint
		return checkpoint?.kind === 'writing' || checkpoint?.kind === 'activating'
			? checkpoint.current.writeId
			: intent.plan.preparation.writeId
	}
	const journalInput = { binding, databaseName: options.databaseName }
	const actors = {
		validate: fromPromise<void>(() =>
			Promise.resolve().then(() => {
				if (
					options.account.id !== binding.identityId ||
					intent.operation.identityId !== binding.identityId ||
					intent.operation.applicationId !== binding.applicationId ||
					intent.operation.environment !== binding.environment ||
					intent.operation.operationId !== binding.operationId ||
					intent.operation.destinationWorkspaceId !== binding.workspaceId
				)
					throw new Error('Restore session scope mismatch')
			})
		),
		journal: createRestoreJournalStepMachine(),
		acquire: fromPromise<void>(() =>
			acquireClient({
				appId: binding.applicationId,
				serverUrl: options.serverUrl,
				account: options.account,
				driver: { type: 'persistent', dbName: 'restore-' + binding.operationId }
			}).then((acquired) => {
				client = acquired
			})
		),
		restore: adapter.machine,
		compare: adapter.comparison,
		acquisition: fromPromise<void>(() =>
			required(custody[0]).acquisition.then((acquired) => {
				transaction = acquired
			})
		),
		pending: fromPromise<unknown>(() => Promise.resolve(required(custody[0]).pending)),
		commit: fromPromise<void>(() =>
			required(required(custody[0]).commit).then((committed) => {
				write = committed
			})
		),
		identify: fromPromise<string>(() => adapter.writer.transactionId(required(write))),
		settle: fromPromise<void>(() => adapter.writer.acceptRemote(required(write))),
		rollback: fromPromise<boolean>(() => adapter.writer.rollback(required(transaction))),
		close: fromPromise<void>(() => required(client).shutdown({ waitForSync: true })),
		release: fromPromise<void>(() => Promise.resolve().then(() => options.releaseArtifacts()))
	}
	const model = setup<
		Context,
		RestoreEvent | { type: 'RETRY_RELEASE' },
		typeof actors,
		{},
		{
			interrupt: undefined
			forgetReceipt: undefined
			rememberWrite: RestoreResult | undefined
			forwardInterrupt: undefined
		},
		{
			interrupted: undefined
			retained: undefined
			clientAcquired: undefined
			moreReceipts: undefined
			remoteRejected: undefined
			rollbackConfirmed: undefined
		},
		never,
		string,
		undefined,
		FinanceRestoreSessionResult
	>({
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined,
			retained: () => custody.length > 0,
			clientAcquired: () => client !== undefined,
			moreReceipts: () => custody.length > 1,
			remoteRejected: ({ event }) =>
				'error' in event &&
				transactionId !== undefined &&
				adapter.writer.isRemoteRejection(event.error, transactionId),
			rollbackConfirmed: ({ event }) => 'output' in event && event.output === true
		},
		actions: {
			forwardInterrupt: forwardTo('operation'),
			rememberWrite: assign({
				record: (_args, result: RestoreResult | undefined) => result?.record,
				outcome: (_args, result: RestoreResult | undefined): Context['outcome'] =>
					result?.outcome === 'complete'
						? 'complete'
						: result?.outcome === 'conflict'
							? 'conflict'
							: 'incomplete'
			}),
			interrupt: assign({
				interruption: ({ context, event }) => restoreInterruption(context.interruption, event)
			}),
			forgetReceipt: () => {
				custody.shift()
				transaction = undefined
				write = undefined
				transactionId = undefined
			}
		}
	})
	const drain = [
		{ guard: 'retained', target: 'waitingForTransaction' },
		{ guard: 'clientAcquired', target: 'closingClient' },
		{ target: 'releasingArtifacts' }
	] satisfies { guard?: 'retained' | 'clientAcquired'; target: string }[]
	const interruptedDrain = [
		{ guard: and(['interrupted', 'retained']), target: 'waitingForTransaction' },
		{ guard: and(['interrupted', 'clientAcquired']), target: 'closingClient' },
		{ guard: and(['interrupted']), target: 'releasingArtifacts' }
	]
	const afterPending = [
		{ guard: () => custody[0]?.commit !== undefined, target: 'waitingForCommit' },
		{ target: 'rollingBack' }
	]
	const afterReceipt = [
		{ guard: 'moreReceipts', target: 'waitingForTransaction', actions: 'forgetReceipt' },
		{ guard: 'clientAcquired', target: 'closingClient', actions: 'forgetReceipt' },
		{ target: 'releasingArtifacts', actions: 'forgetReceipt' }
	] satisfies {
		guard?: 'moreReceipts' | 'clientAcquired'
		target: string
		actions: 'forgetReceipt'
	}[]
	const verifiedRelease = (proof: 'remoteRejected' | 'rollbackConfirmed') => [
		{
			guard: and([proof, 'moreReceipts']),
			target: 'waitingForTransaction',
			actions: { type: 'forgetReceipt' } satisfies { type: 'forgetReceipt' }
		},
		{
			guard: and([proof, 'clientAcquired']),
			target: 'closingClient',
			actions: { type: 'forgetReceipt' } satisfies { type: 'forgetReceipt' }
		},
		{
			guard: proof,
			target: 'releasingArtifacts',
			actions: { type: 'forgetReceipt' } satisfies { type: 'forgetReceipt' }
		},
		{ target: proof === 'remoteRejected' ? 'settlementBlocked' : 'rollbackBlocked' }
	]
	const rememberWrite = {
		type: 'rememberWrite',
		params: ({ event }: { event: { output: RestoreResult | undefined } }) => event.output
	} satisfies {
		type: 'rememberWrite'
		params: (args: { event: { output: RestoreResult | undefined } }) => RestoreResult | undefined
	}
	const forwardInterrupt = {
		CANCEL: {
			actions: ['interrupt', 'forwardInterrupt'] satisfies ('interrupt' | 'forwardInterrupt')[]
		},
		SHUTDOWN: {
			actions: ['interrupt', 'forwardInterrupt'] satisfies ('interrupt' | 'forwardInterrupt')[]
		},
		INVALIDATE: {
			guard: ({ event }: { event: RestoreEvent }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(binding, event.binding),
			actions: ['interrupt', 'forwardInterrupt'] satisfies ('interrupt' | 'forwardInterrupt')[]
		}
	}
	return model.createMachine({
		context: { outcome: 'incomplete', record: undefined, interruption: undefined },
		initial: 'validating',
		output: ({ context }) => ({
			outcome: context.interruption ?? context.outcome,
			record: context.record
		}),
		on: {
			CANCEL: { actions: 'interrupt' },
			SHUTDOWN: { actions: 'interrupt' },
			INVALIDATE: {
				guard: ({ event }) => sameBackupBinding(binding, event.binding),
				actions: 'interrupt'
			}
		},
		states: {
			validating: {
				invoke: {
					src: 'validate',
					onDone: [...interruptedDrain, { target: 'initializingJournal' }],
					onError: drain
				}
			},
			initializingJournal: {
				invoke: {
					src: 'journal',
					input: { ...journalInput, command: { mode: 'initialize' } },
					onDone: [
						{
							guard: ({ context, event }) =>
								!context.interruption && event.output?.outcome === 'initialized',
							target: 'loadingJournal'
						},
						...drain
					],
					onError: drain
				}
			},
			loadingJournal: {
				invoke: {
					src: 'journal',
					input: { ...journalInput, command: { mode: 'load', intent } },
					onDone: [
						{
							guard: ({ context, event }) =>
								!context.interruption &&
								event.output?.outcome === 'loaded' &&
								event.output?.record?.checkpoint.kind === 'complete',
							target: 'releasingArtifacts',
							actions: assign({ outcome: 'complete', record: ({ event }) => event.output?.record })
						},
						{
							guard: ({ event }) =>
								event.output?.outcome === 'conflict' ||
								event.output?.record?.checkpoint.kind === 'conflict',
							target: 'releasingArtifacts',
							actions: assign({ outcome: 'conflict', record: ({ event }) => event.output?.record })
						},
						{
							guard: ({ context, event }) =>
								!context.interruption &&
								((event.output?.outcome === 'loaded' && event.output?.record !== undefined) ||
									(event.output?.outcome === 'missing' && options.mode === 'new')),
							target: 'acquiringClient',
							actions: assign({ record: ({ event }) => event.output?.record })
						},
						...drain
					],
					onError: drain
				}
			},
			acquiringClient: {
				invoke: {
					src: 'acquire',
					onDone: [
						...interruptedDrain,
						{
							guard: () =>
								db.getAuthState().session?.user !== binding.identityId ||
								db.getConfig().appId !== binding.applicationId,
							target: 'closingClient',
							actions: assign({ interruption: 'invalidated' })
						},
						{
							guard: ({ context }) => context.record?.checkpoint.kind === 'comparing',
							target: 'comparing'
						},
						{ target: 'writing' }
					],
					onError: drain
				}
			},
			writing: {
				on: forwardInterrupt,
				invoke: {
					id: 'operation',
					src: 'restore',
					input: ({ context }) => ({
						...journalInput,
						intent,
						writeId: checkpointWrite(context.record)
					}),
					onDone: [
						...interruptedDrain.map((route) => ({ ...route, actions: rememberWrite })),
						{
							guard: ({ event }) =>
								(event.output?.outcome === 'prepared' ||
									event.output?.outcome === 'batchWritten') &&
								event.output?.record?.checkpoint.kind === 'comparing',
							target: 'comparing',
							actions: assign({ record: ({ event }) => event.output?.record })
						},
						{
							guard: ({ event }) =>
								(event.output?.outcome === 'prepared' ||
									event.output?.outcome === 'batchWritten') &&
								event.output?.record?.checkpoint.kind === 'writing',
							target: 'writing',
							reenter: true,
							actions: assign({ record: ({ event }) => event.output?.record })
						},
						...drain.map((route) => ({ ...route, actions: rememberWrite }))
					],
					onError: drain
				}
			},
			comparing: {
				on: forwardInterrupt,
				invoke: {
					id: 'operation',
					src: 'compare',
					input: ({ context }) => ({ ...journalInput, record: required(context.record) }),
					onDone: [
						{
							guard: ({ context, event }) =>
								!context.interruption && event.output?.checkpoint.kind === 'activating',
							target: 'writing',
							actions: assign({ record: ({ event }) => event.output })
						},
						...drain
					],
					onError: drain
				}
			},
			waitingForTransaction: {
				invoke: { src: 'acquisition', onDone: 'waitingForPending', onError: 'restartRequired' }
			},
			waitingForPending: {
				invoke: { src: 'pending', onDone: afterPending, onError: afterPending }
			},
			waitingForCommit: {
				invoke: { src: 'commit', onDone: 'identifyingCommit', onError: 'restartRequired' }
			},
			identifyingCommit: {
				invoke: {
					src: 'identify',
					onDone: {
						target: 'settlingCommit',
						actions: ({ event }) => {
							transactionId = event.output
						}
					},
					onError: 'identificationBlocked'
				}
			},
			settlingCommit: {
				invoke: {
					src: 'settle',
					onDone: afterReceipt,
					onError: verifiedRelease('remoteRejected')
				}
			},
			rollingBack: {
				invoke: {
					src: 'rollback',
					onDone: verifiedRelease('rollbackConfirmed'),
					onError: 'rollbackBlocked'
				}
			},
			closingClient: {
				invoke: {
					src: 'close',
					onDone: {
						target: 'releasingArtifacts',
						actions: () => {
							client = undefined
						}
					},
					onError: 'clientBlocked'
				}
			},
			releasingArtifacts: {
				invoke: { src: 'release', onDone: 'complete', onError: 'artifactsBlocked' }
			},
			restartRequired: { tags: 'restore-restart-required' },
			identificationBlocked: {
				tags: 'restore-release-blocked',
				on: { RETRY_RELEASE: 'identifyingCommit' }
			},
			settlementBlocked: {
				tags: 'restore-release-blocked',
				on: { RETRY_RELEASE: 'settlingCommit' }
			},
			rollbackBlocked: {
				tags: 'restore-release-blocked',
				on: { RETRY_RELEASE: 'rollingBack' }
			},
			clientBlocked: { tags: 'restore-release-blocked', on: { RETRY_RELEASE: 'closingClient' } },
			artifactsBlocked: {
				tags: 'restore-release-blocked',
				on: { RETRY_RELEASE: 'releasingArtifacts' }
			},
			complete: { type: 'final' }
		}
	})
}

type RecoveryInput = RestoreDestinationInput<Transaction<'mergeable'>>
export function recoveryQueries(graph: FinanceRestoreGraph, operationId: string) {
	const workspaceId = graph.workspace.id,
		files = graph.files.map((file) => file.id),
		transactions = graph.transactions.map((row) => row.id)
	return {
		operation: app.restoreOperations.where({ id: operationId }),
		accounts: app.accounts.where({ organizationId: workspaceId }).orderBy('id'),
		categories: app.categories.where({ organizationId: workspaceId }).orderBy('id'),
		tags: app.tags.where({ organizationId: workspaceId }).orderBy('id'),
		checks: app.checks.where({ organizationId: workspaceId }).orderBy('id'),
		batches: app.transactionBatches.where({ organizationId: workspaceId }).orderBy('id'),
		templates: app.batchTemplates.where({ organizationId: workspaceId }).orderBy('id'),
		transactions: app.transactions.where({ organizationId: workspaceId }).orderBy('id'),
		transactionTags: app.transactionTags.where({ organizationId: workspaceId }).orderBy('id'),
		transfers: app.internalTransfers.where({ organizationId: workspaceId }).orderBy('id'),
		files: app.files.where({ transactionId: { in: transactions } }).orderBy('id'),
		links: app.transactionAttachments.where({ transactionId: { in: transactions } }).orderBy('id'),
		parts: app.fileParts
			.where({ fileId: { in: files } })
			.orderBy('fileId')
			.orderBy('partIndex'),
		source: app.files.where({ id: graph.source.file.id }),
		sourceParts: app.fileParts.where({ fileId: graph.source.file.id }).orderBy('partIndex'),
		members: app.organizationMembers.where({ organizationId: workspaceId }).orderBy('id')
	}
}
export function readRecovery(
	db: Pick<Db, 'all'>,
	queries: ReturnType<typeof recoveryQueries>,
	tier: 'remote' | 'local-first'
) {
	return Promise.all([
		db.all(queries.operation, { tier }),
		db.all(queries.accounts, { tier }),
		db.all(queries.categories, { tier }),
		db.all(queries.tags, { tier }),
		db.all(queries.checks, { tier }),
		db.all(queries.batches, { tier }),
		db.all(queries.templates, { tier }),
		db.all(queries.transactions, { tier }),
		db.all(queries.transactionTags, { tier }),
		db.all(queries.transfers, { tier }),
		db.all(queries.files, { tier }),
		db.all(queries.links, { tier }),
		db.all(queries.parts, { tier }),
		db.all(queries.members, { tier }),
		db.all(queries.source, { tier }),
		db.all(queries.sourceParts, { tier })
	])
}
type RecoveryObservation = Awaited<ReturnType<typeof readRecovery>>
function stageRecovery(
	tx: Transaction<'mergeable'>,
	sample: FinanceRestorePlan,
	writeId: string,
	archive: IntegrityCheckedArchive
) {
	const { graph, intent } = sample
	if (writeId === intent.plan.preparation.writeId) {
		const { id, ...root } = graph.workspace
		tx.insert(
			app.organizations,
			{ ...root, restoreOperationId: intent.operation.operationId },
			{ id }
		)
		tx.insert(
			app.restoreOperations,
			{
				workspaceId: id,
				sourceFileId: graph.source.file.id,
				ownerId: root.ownerId,
				status: 'incomplete',
				payloadSha256: intent.archive.payloadSha256,
				graphSha256: intent.plan.expectedGraphSha256,
				workspaceName: root.name,
				workspaceKind: root.kind,
				workspaceCurrency: root.defaultCurrency
			},
			{ id: intent.operation.operationId }
		)
		const { id: sourceFileId, ...source } = graph.source.file
		tx.insert(app.files, source, { id: sourceFileId })
		const bytes = archive.copyPayloadBytes()
		try {
			for (const { id, ...part } of graph.source.parts)
				tx.insert(
					app.fileParts,
					{
						...part,
						data: bytes.slice(
							part.partIndex * restorePartBytes,
							part.partIndex * restorePartBytes + part.sizeBytes
						)
					},
					{ id }
				)
		} finally {
			bytes.fill(0)
		}
		return
	}
	if (writeId === intent.plan.activation.writeId) {
		tx.update(app.restoreOperations, intent.operation.operationId, { status: 'active' })
		const { id, ...member } = graph.member
		tx.insert(app.organizationMembers, member, { id })
		return
	}
	for (const { id, archivedAt, ...row } of graph.accounts)
		tx.insert(
			app.accounts,
			{ ...row, archivedAt: archivedAt === null ? null : new Date(archivedAt) },
			{ id }
		)
	for (const { id, archivedAt, ...row } of graph.categories)
		tx.insert(
			app.categories,
			{ ...row, archivedAt: archivedAt === null ? null : new Date(archivedAt) },
			{ id }
		)
	for (const { id, archivedAt, ...row } of graph.tags)
		tx.insert(
			app.tags,
			{ ...row, archivedAt: archivedAt === null ? null : new Date(archivedAt) },
			{ id }
		)
	for (const { id, ...row } of graph.checks) tx.insert(app.checks, row, { id })
	for (const { id, ...row } of graph.batches) tx.insert(app.transactionBatches, row, { id })
	for (const { id, ...row } of graph.templates) tx.insert(app.batchTemplates, row, { id })
	for (const { id, externalId, ...row } of graph.transactions)
		tx.insert(app.transactions, { ...row, ...(externalId === null ? {} : { externalId }) }, { id })
	for (const { id, ...row } of graph.transactionTags) tx.insert(app.transactionTags, row, { id })
	// Nullable transformed columns must be omitted on insertion to retain the null default.
	for (const {
		id,
		amountMinor,
		currency,
		expenseAmountMinor,
		expenseCurrency,
		incomeAmountMinor,
		incomeCurrency,
		...row
	} of graph.transfers)
		tx.insert(
			app.internalTransfers,
			{
				...row,
				...(amountMinor === null ? {} : { amountMinor }),
				...(currency === null ? {} : { currency }),
				...(expenseAmountMinor === null ? {} : { expenseAmountMinor }),
				...(expenseCurrency === null ? {} : { expenseCurrency }),
				...(incomeAmountMinor === null ? {} : { incomeAmountMinor }),
				...(incomeCurrency === null ? {} : { incomeCurrency })
			},
			{ id }
		)
	for (const { id, ...row } of graph.files) tx.insert(app.files, row, { id })
	for (const { id, ...row } of graph.links) tx.insert(app.transactionAttachments, row, { id })
	for (const { id, data, ...row } of graph.parts)
		tx.insert(app.fileParts, { ...row, data: new Uint8Array(data) }, { id })
}
/** Native Finance destination; DLF owns the journal, lock and transaction lifetime. */
export function createFinanceRestoreAdapter(
	db: FinanceRestoreDb,
	sample: FinanceRestorePlan,
	archive: IntegrityCheckedArchive,
	retain: RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
) {
	const payload = archive.readPayload(),
		{ intent, graph } = sample
	if (intent.plan.batches.length > 1)
		throw new Error('Restore adapter supports one financial batch')
	if (
		!validateFinanceBackup(payload) ||
		archive.payloadDigest() !== intent.archive.payloadSha256 ||
		payload.archiveId !== intent.archive.archiveId ||
		canonicalRecovery(payload.profile) !== canonicalRecovery(intent.archive.profile) ||
		canonicalRecovery(payload.source) !== canonicalRecovery(intent.archive.source)
	)
		throw new Error('Recovery archive binding mismatch')
	const queries = recoveryQueries(graph, intent.operation.operationId)
	const control = {
		id: intent.operation.operationId,
		workspaceId: graph.workspace.id,
		sourceFileId: graph.source.file.id,
		ownerId: graph.workspace.ownerId,
		payloadSha256: intent.archive.payloadSha256,
		graphSha256: intent.plan.expectedGraphSha256,
		workspaceName: graph.workspace.name,
		workspaceKind: graph.workspace.kind,
		workspaceCurrency: graph.workspace.defaultCurrency
	}
	const expectedRows = financeGraphRows(graph)
	const matchesScope = (observed: RecoveryObservation) => {
		const row = observed[0][0]
		if (!row || observed[0].length !== 1) return false
		const { status: _status, ...rest } = row
		return canonicalRecovery(rest) === canonicalRecovery(control)
	}
	const sourceDigests = new WeakMap<RecoveryObservation, string>()
	const sourceLayout = (observed: RecoveryObservation | undefined) =>
		observed !== undefined &&
		canonicalRecovery(observed[14]) === canonicalRecovery([graph.source.file]) &&
		canonicalRecovery(observed[15].map(({ data: _data, ...part }) => part)) ===
			canonicalRecovery(graph.source.parts) &&
		observed[15].every((part) => part.data?.byteLength === part.sizeBytes)
	const matchesGraph = (observed: RecoveryObservation) =>
		canonicalRecovery(observed.slice(1, 13)) === canonicalRecovery(expectedRows) &&
		sourceLayout(observed) &&
		sourceDigests.get(observed) === intent.archive.payloadSha256
	const noFinancialRows = (observed: RecoveryObservation) =>
		observed.slice(1, 13).every((rows) => rows.length === 0)
	const presence = (
		observed: RecoveryObservation,
		input: RecoveryInput
	): RestoreDestinationResult => {
		const phase = observed[0][0]?.status
		if (input.step.writeId === intent.plan.preparation.writeId)
			return matchesScope(observed) &&
				sourceLayout(observed) &&
				sourceDigests.get(observed) === intent.archive.payloadSha256 &&
				(intent.plan.batches.length > 0 || matchesGraph(observed))
				? 'match'
				: observed.every((rows) => rows.length === 0)
					? 'missingOrHidden'
					: 'conflict'
		if (!matchesScope(observed)) return 'conflict'
		if (input.step.writeId === intent.plan.activation.writeId) {
			if (!matchesGraph(observed)) return 'conflict'
			if (
				phase === 'active' &&
				canonicalRecovery(observed[13]) === canonicalRecovery([graph.member])
			)
				return 'match'
			return phase === 'incomplete' && observed[13].length === 0 ? 'missingOrHidden' : 'conflict'
		}
		return matchesGraph(observed)
			? 'match'
			: phase === 'incomplete' &&
				  noFinancialRows(observed) &&
				  sourceLayout(observed) &&
				  sourceDigests.get(observed) === intent.archive.payloadSha256
				? 'missingOrHidden'
				: 'conflict'
	}
	const authority = (observed: RecoveryObservation | undefined, input: RecoveryInput) =>
		observed !== undefined &&
		(input.step.writeId === intent.plan.preparation.writeId
			? observed.every((rows) => rows.length === 0)
			: observed[0][0]?.status === 'incomplete' && presence(observed, input) === 'missingOrHidden')
	type Handle = { toJSON(): { kind: 'financeRecoveryObservation' } }
	const observations = new WeakMap<Handle, RecoveryObservation | undefined>()

	type Context = {
		input: RecoveryInput
		handle: Handle
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: RestoreDestinationResult
	}
	type LeafInput = Pick<Context, 'input' | 'handle'>
	const actors = {
		fingerprint: fromPromise<boolean, RecoveryInput>(async () => {
			const { sha256, ...plan } = intent.plan
			const [graphHash, planHash] = await Promise.all([digestRecovery(graph), digestRecovery(plan)])
			return graphHash === intent.plan.expectedGraphSha256 && planHash === sha256
		}),
		read: fromPromise<void, LeafInput>(async ({ input: { input, handle } }) => {
			const observed =
				input.operation === 'read'
					? await restoreTransactionAccess(input).call((tx) =>
							readRecovery(tx, queries, 'local-first')
						)
					: await readRecovery(db, queries, 'remote')
			if (observations.has(handle)) observations.set(handle, observed)
		}),
		stage: fromPromise<void, RecoveryInput>(({ input }) =>
			restoreTransactionAccess(input).call((tx) =>
				stageRecovery(tx, sample, input.step.writeId, archive)
			)
		),
		hashSource: fromPromise<void, LeafInput>(async ({ input: { handle } }) => {
			const observed = observations.get(handle)
			if (!observed) throw new Error('Missing source snapshot')
			const bytes = new Uint8Array(graph.source.file.sizeBytes)
			try {
				for (const part of observed[15]) {
					if (!part.data) throw new Error('Missing source bytes')
					bytes.set(part.data, part.partIndex * restorePartBytes)
				}
				const digest = await crypto.subtle.digest('SHA-256', bytes)
				if (observations.get(handle) === observed)
					sourceDigests.set(
						observed,
						[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
					)
			} finally {
				bytes.fill(0)
			}
		})
	}
	const model = setup<
		Context,
		RestoreEvent,
		typeof actors,
		{},
		{ interrupt: undefined; classify: undefined },
		{},
		never,
		string,
		RecoveryInput,
		RestoreDestinationResult
	>({
		actors,
		actions: {
			classify: assign({
				result: ({ context }) => {
					const observed = observations.get(context.handle)
					return observed ? presence(observed, context.input) : 'unavailable'
				}
			}),
			interrupt: assign({
				interruption: ({ context, event }) => restoreInterruption(context.interruption, event)
			})
		}
	})
	const readCompletion = [
		{ guard: ({ context }) => context.interruption !== undefined, target: 'complete' },
		{
			guard: ({ context }) =>
				context.input.operation === 'authority' &&
				authority(observations.get(context.handle), context.input),
			target: 'allowed'
		},
		{ target: 'complete', actions: 'classify' }
	] satisfies {
		target: string
		guard?: (args: { context: Context }) => boolean
		actions?: 'classify'
	}[]
	const destination = model.createMachine({
		context: ({ input }) => {
			const handle: Handle = { toJSON: () => ({ kind: 'financeRecoveryObservation' }) }
			observations.set(handle, undefined)
			return { input, handle, result: 'unavailable', interruption: undefined }
		},
		initial: 'validating',
		output: ({ context }) => context.interruption ?? context.result,
		on: {
			CANCEL: { actions: 'interrupt' },
			SHUTDOWN: { actions: 'interrupt' },
			INVALIDATE: {
				guard: ({ context, event }) => sameBackupBinding(context.input.binding, event.binding),
				actions: 'interrupt'
			}
		},
		states: {
			validating: {
				invoke: {
					src: 'fingerprint',
					input: ({ context }) => context.input,
					onDone: [
						{
							guard: ({ context, event }) =>
								!event.output ||
								db.getAuthState().session?.user !== intent.operation.identityId ||
								canonicalRecovery(context.input.intent) !== canonicalRecovery(intent) ||
								db.getConfig().appId !== intent.operation.applicationId ||
								context.input.binding.workspaceId !== graph.workspace.id ||
								context.input.binding.operationId !== intent.operation.operationId,
							target: 'complete'
						},
						{ guard: ({ context }) => context.interruption !== undefined, target: 'complete' },
						{ guard: ({ context }) => context.input.operation === 'stage', target: 'staging' },
						{ target: 'reading' }
					],
					onError: 'complete'
				}
			},
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: [
						{
							guard: ({ context }) =>
								!context.interruption && sourceLayout(observations.get(context.handle)),
							target: 'hashingSource'
						},
						...readCompletion
					],
					onError: 'complete'
				}
			},
			hashingSource: {
				invoke: {
					src: 'hashSource',
					input: ({ context }) => context,
					onDone: readCompletion,
					onError: 'complete'
				}
			},

			staging: {
				invoke: {
					src: 'stage',
					input: ({ context }) => context.input,
					onDone: [
						{ guard: ({ context }) => context.interruption !== undefined, target: 'complete' },
						{ target: 'complete', actions: assign({ result: 'staged' }) }
					],
					onError: 'complete'
				}
			},
			allowed: {
				type: 'final',
				entry: [assign({ result: 'allowed' }), ({ context }) => observations.delete(context.handle)]
			},
			complete: { type: 'final', entry: ({ context }) => observations.delete(context.handle) }
		}
	})
	const writer: RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle> = {
		open: () => db.beginTransaction(),
		commit: (tx) => tx.commit(),
		transactionId: (write) => write.txId,
		persistLocal: (write) => write.wait({ tier: 'local' }),
		acceptRemote: (write) => write.wait({ tier: 'global' }),
		isRemoteRejection: (error, id) =>
			error instanceof PersistedWriteRejectedError && error.transactionId === id,
		rollback: (tx) => tx.rollback(),
		retainDetached: retain
	}
	type ComparisonInput = {
		record: import('delightful-local-first/backup/restore/journal').RestoreJournalRecord
		binding: RecoveryInput['binding']
		databaseName: string
	}
	const comparisonActors = { destination, journal: createRestoreJournalStepMachine() }
	const comparisonModel = setup<
		ComparisonInput & {
			candidate: ComparisonInput['record'] | undefined
			result: ComparisonInput['record'] | undefined
			interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		},
		RestoreEvent,
		typeof comparisonActors,
		{},
		{ interrupt: undefined },
		{},
		never,
		string,
		ComparisonInput,
		ComparisonInput['record'] | undefined
	>({
		actors: comparisonActors,
		actions: {
			interrupt: assign({
				interruption: ({ context, event }) => restoreInterruption(context.interruption, event)
			})
		}
	})
	const comparison = comparisonModel.createMachine({
		context: ({ input }) => ({
			...input,
			candidate: undefined,
			result: undefined,
			interruption: undefined
		}),
		initial: 'comparing',
		output: ({ context }) => (context.interruption ? undefined : context.result),
		on: {
			CANCEL: { actions: 'interrupt' },
			SHUTDOWN: { actions: 'interrupt' },
			INVALIDATE: {
				guard: ({ context, event }) => sameBackupBinding(context.binding, event.binding),
				actions: 'interrupt'
			}
		},
		states: {
			comparing: {
				on: {
					CANCEL: { actions: ['interrupt', forwardTo('snapshot')] },
					SHUTDOWN: { actions: ['interrupt', forwardTo('snapshot')] },
					INVALIDATE: {
						guard: ({ context, event }) => sameBackupBinding(context.binding, event.binding),
						actions: ['interrupt', forwardTo('snapshot')]
					}
				},
				invoke: {
					id: 'snapshot',
					src: 'destination',
					input: ({ context }) => ({
						binding: context.binding,
						databaseName: context.databaseName,
						intent,
						step: intent.plan.batches[0] ?? intent.plan.preparation,
						operation: 'remote'
					}),
					onDone: [
						{
							guard: ({ context, event }) =>
								!context.interruption &&
								event.output === 'match' &&
								context.record.checkpoint.kind === 'comparing',
							target: 'saving',
							actions: assign({
								candidate: ({ context }) => {
									if (context.record.checkpoint.kind !== 'comparing')
										throw new Error('Comparison checkpoint required')
									return parseRestoreJournalRecord({
										...context.record,
										revision: context.record.revision + 1,
										checkpoint: {
											kind: 'activating',
											completed: context.record.checkpoint.completed,
											comparison: {
												payloadSha256: intent.archive.payloadSha256,
												graphSha256: intent.plan.expectedGraphSha256
											},
											current: {
												status: 'notIssued',
												writeId: intent.plan.activation.writeId,
												issuance: 0
											}
										}
									})
								}
							})
						},
						{ target: 'complete' }
					],
					onError: 'complete'
				}
			},
			saving: {
				invoke: {
					src: 'journal',
					input: ({ context }) => {
						if (!context.candidate) throw new Error('Missing comparison candidate')
						return {
							binding: context.binding,
							databaseName: context.databaseName,
							command: {
								mode: 'update',
								expectedRevision: context.record.revision,
								record: context.candidate
							}
						}
					},
					onDone: {
						target: 'complete',
						actions: assign({
							result: ({ event }) =>
								event.output.outcome === 'updated' || event.output.outcome === 'existing'
									? event.output.record
									: undefined
						})
					},
					onError: 'complete'
				}
			},
			complete: { type: 'final' }
		}
	})
	return {
		machine: createRestoreMachine(writer, destination),
		comparison,
		destination,
		writer
	}
}

export type WorkspaceRestoreFile = { toJSON(): { kind: 'workspaceRestoreFile' }; release(): void }
export type WorkspaceRestoreConfiguration = {
	appId: string
	serverUrl: string
	environment: string
}
type RestoreScope = WorkspaceRestoreConfiguration & {
	session: JazzSession<JazzClient>
	account: AccountHandle
	client: JazzClient
}
type RestoreFileData = {
	file: File
	name?: string | undefined
	password: string | undefined
	scope?: RestoreScope | undefined
	bytes?: Uint8Array | undefined
	envelope?: ArchiveEnvelopeRequest | undefined
	archive?: IntegrityCheckedArchive | undefined
	plan?: FinanceRestorePlanRequest | undefined
	binding?: BackupBinding | undefined
	previous?: RestoreJournalRecord | undefined
	logic?: ReturnType<typeof createFinanceWorkspaceRestore> | undefined
}
const restoreFiles = new WeakMap<WorkspaceRestoreFile, RestoreFileData>()
export function prepareWorkspaceRestoreFile(file: File, password: string): WorkspaceRestoreFile {
	const request: WorkspaceRestoreFile = {
		toJSON: () => ({ kind: 'workspaceRestoreFile' }),
		release() {
			const value = restoreFiles.get(request)
			value?.bytes?.fill(0)
			value?.plan?.release()
			value?.archive?.release()
			value?.envelope?.release()
			restoreFiles.delete(request)
		}
	}
	restoreFiles.set(request, { file, password: password || undefined })
	return request
}
function restoreFile(request: WorkspaceRestoreFile | undefined) {
	return required(request && restoreFiles.get(request))
}
export function workspaceRestoreSessionReady(session: JazzSession<JazzClient> | undefined) {
	const state = session?.getSnapshot()
	return state?.status === 'ready' && state.account !== undefined && state.client !== undefined
}
export function workspaceRestoreFileAvailable(request: WorkspaceRestoreFile) {
	return restoreFiles.has(request) && restoreFiles.get(request)?.scope === undefined
}
function restoreScopeCurrent(scope: RestoreScope) {
	const state = scope.session.getSnapshot()
	return (
		state.status === 'ready' &&
		state.account?.id === scope.account.id &&
		state.client === scope.client
	)
}
export function bindWorkspaceRestoreFile(
	request: WorkspaceRestoreFile,
	session: JazzSession<JazzClient>,
	config: WorkspaceRestoreConfiguration
) {
	const state = session.getSnapshot()
	if (state.status !== 'ready' || !state.account || !state.client)
		throw new Error('Restore session unavailable')
	restoreFile(request).scope = { ...config, session, account: state.account, client: state.client }
}
const restoreJournalName = 'finance-workspace-restores'
export type WorkspaceRestoreCommand = {
	type: 'CONFIRM' | 'CANCEL' | 'DRAIN' | 'RETRY_RELEASE' | 'DISMISS' | 'OPEN' | 'RELOAD'
}
export type WorkspaceRestoreMessage =
	'preparing' | 'restoring' | 'done' | 'cancelled' | 'failed' | 'conflict' | undefined
export type WorkspaceRestoreView = {
	alert: boolean
	busy: boolean
	editable: boolean
	canConfirm: boolean
	confirmAction: 'create' | 'retry'
	canCancel: boolean
	canRetryRelease: boolean
	canReload: boolean
	canOpen: boolean
	visibleOutsideSettings: boolean
	message: WorkspaceRestoreMessage
	workspaceName: string | undefined
	workspaceId: string | undefined
	identityId: string | undefined
}
export const emptyWorkspaceRestoreView: WorkspaceRestoreView = {
	alert: false,
	busy: false,
	editable: true,
	canConfirm: false,
	confirmAction: 'create',
	canCancel: false,
	canRetryRelease: false,
	canReload: false,
	canOpen: false,
	visibleOutsideSettings: false,
	message: undefined,
	workspaceName: undefined,
	workspaceId: undefined,
	identityId: undefined
}
type RestoreControllerContext = {
	request: WorkspaceRestoreFile | undefined
	binding: BackupBinding | undefined
	previous: RestoreJournalRecord | undefined
	native: ActorRefFrom<ReturnType<typeof createFinanceWorkspaceRestore>> | undefined
	interruption: 'cancelled' | 'invalidated' | undefined
	result: 'done' | 'cancelled' | 'failed' | 'conflict' | undefined
	name: string | undefined
}
type RestoreControllerEvent =
	| WorkspaceRestoreCommand
	| { type: 'SUBMIT'; request: WorkspaceRestoreFile }
	| { type: 'SCOPE_CHANGED' }
	| {
			type: `xstate.done.actor.${string}`
			output: FinanceRestoreSessionResult
			actorId: string
	  }
	| { type: `xstate.error.actor.${string}`; error: unknown; actorId: string }
	| {
			type: `xstate.snapshot.${string}`
			snapshot: SnapshotFrom<ReturnType<typeof createFinanceWorkspaceRestore>>
	  }
/** Root-lifetime controller. Dynamic native children own each checked operation's SDK resources. */
export function createWorkspaceRestoreController(
	navigate: (destination: string) => Promise<void> = async () => {
		throw new Error('Navigation unavailable')
	},
	acquireClient: (config: DbConfig) => Promise<RestoreClient> = openRestoreClient
) {
	const actors = {
		observe: fromCallback<RestoreControllerEvent, WorkspaceRestoreFile>(({ input, sendBack }) => {
			const scope = required(restoreFile(input).scope)
			const observe = () => {
				try {
					if (!restoreScopeCurrent(scope)) sendBack({ type: 'SCOPE_CHANGED' })
				} catch {
					sendBack({ type: 'SCOPE_CHANGED' })
				}
			}
			observe()
			return scope.session.subscribe(observe)
		}),
		readFile: fromPromise<void, WorkspaceRestoreFile>(async ({ input }) => {
			const value = restoreFile(input)
			if (
				!Number.isSafeInteger(value.file.size) ||
				value.file.size <= 0 ||
				value.file.size > 64 * 1024 * 1024
			)
				throw new Error('Invalid restore file size')
			const bytes = new Uint8Array(await value.file.arrayBuffer())
			value.bytes = bytes
			if (bytes.length !== value.file.size) throw new Error('Restore file changed')
		}),
		prepareEnvelope: fromPromise<void, WorkspaceRestoreFile>(({ input }) => {
			const value = restoreFile(input),
				bytes = required(value.bytes)
			value.envelope = prepareArchiveOpen(bytes, value.password)
			value.password = undefined
			bytes.fill(0)
			value.bytes = undefined
			return Promise.resolve()
		}),
		open: createArchiveEnvelopeMachine(),
		validateFile: fromPromise<string, WorkspaceRestoreFile>(({ input }) => {
			const value = restoreFile(input),
				archive = required(value.archive),
				payload = archive.readPayload()
			if (!validateFinanceBackup(payload)) throw new Error('Unsupported Finance backup')
			const bytes = archive.copyPayloadBytes(),
				size = bytes.length
			bytes.fill(0)
			const ids = new Set(
					payload.records.filter((row) => row.type === 'files').map((row) => row.id)
				),
				files = payload.attachments.filter((file) => ids.has(file.id))
			if (
				size > payloadLimits.attachmentBytes ||
				size + files.reduce((sum, file) => sum + file.sizeBytes, 0) >
					payloadLimits.totalAttachmentBytes ||
				files.length + 1 > payloadLimits.attachments ||
				payload.records.length + 2 > payloadLimits.records
			)
				throw new Error('Restore exceeds backup capacity')
			const name = payload.records.find(
				(row) => row.type === 'organizations' && row.id === payload.source.workspaceId
			)?.fields.name
			if (name?.kind !== 'text') throw new Error('Missing workspace')
			value.name = name.value
			return Promise.resolve(name.value)
		}),
		deriveBinding: fromPromise<BackupBinding, WorkspaceRestoreFile>(async ({ input }) => {
			const value = restoreFile(input),
				archive = required(value.archive),
				scope = required(value.scope),
				payload = archive.readPayload()
			const operationId = await stableUuid(
					scope.account.id,
					JSON.stringify([scope.appId, scope.environment, archive.payloadDigest()])
				),
				workspaceId = await stableUuid(
					operationId,
					JSON.stringify(['record', 'organizations', payload.source.workspaceId])
				)
			const binding = {
				applicationId: scope.appId,
				environment: scope.environment,
				identityId: scope.account.id,
				operationId,
				workspaceId,
				generation: 0
			}
			value.binding = binding
			return binding
		}),
		journal: createRestoreJournalStepMachine(),
		preparePlan: fromPromise<void, WorkspaceRestoreFile>(({ input }) => {
			const value = restoreFile(input),
				binding = required(value.binding),
				archive = required(value.archive)
			value.plan = prepareFinanceRestorePlan(
				archive,
				{ ...binding, workspaceId: archive.readPayload().source.workspaceId },
				value.previous?.intent
			)
			return Promise.resolve()
		}),
		plan: financeRestorePlanningMachine,
		prepareNative: fromPromise<void, WorkspaceRestoreFile>(({ input }) => {
			const value = restoreFile(input),
				scope = required(value.scope)
			if (!restoreScopeCurrent(scope)) throw new Error('Restore scope changed')
			value.logic = createFinanceWorkspaceRestore(
				{
					account: scope.account,
					serverUrl: scope.serverUrl,
					binding: required(value.binding),
					databaseName: restoreJournalName,
					mode: value.previous ? 'resume' : 'new',
					archive: required(value.archive),
					plan: required(value.plan),
					releaseFile() {
						value.envelope?.release()
						value.envelope = undefined
						value.archive = undefined
						value.plan = undefined
					}
				},
				acquireClient
			)
			return Promise.resolve()
		}),
		cleanup: fromPromise<void, WorkspaceRestoreFile | undefined>(({ input }) => {
			input?.release()
			return Promise.resolve()
		}),
		navigate: fromPromise<void, BackupBinding>(({ input }) =>
			navigate('/settings/workspace?workspace=' + encodeURIComponent(input.workspaceId))
		)
	}
	const model = setup<
		RestoreControllerContext,
		RestoreControllerEvent,
		typeof actors,
		{},
		{ interrupt: undefined; fail: undefined; rememberName: undefined; rememberBinding: undefined },
		{},
		never,
		string
	>({
		actors,
		actions: {
			fail: assign({ result: 'failed' }),
			rememberName: assign({ name: ({ context }) => restoreFile(context.request).name }),
			rememberBinding: assign({
				binding: ({ context }) => required(restoreFile(context.request).binding)
			}),
			interrupt: assign({
				interruption: ({ context, event }) =>
					event.type === 'CANCEL' ? (context.interruption ?? 'cancelled') : 'invalidated'
			})
		}
	})
	const input = ({ context }: { context: RestoreControllerContext }) => required(context.request)
	const afterLeaf = (target: string, action?: 'rememberName' | 'rememberBinding') => [
		{
			guard: ({ context }: { context: RestoreControllerContext }) =>
				context.interruption !== undefined,
			target: 'cleaning',
			actions: action ? [{ type: action }] : []
		},
		{ target, actions: action ? [{ type: action }] : [] }
	]
	const fail = { target: 'cleaning', actions: { type: 'fail' } satisfies { type: 'fail' } }
	return model.createMachine({
		id: 'workspace-restore-controller',
		initial: 'idle',
		context: {
			request: undefined,
			binding: undefined,
			previous: undefined,
			native: undefined,
			interruption: undefined,
			result: undefined,
			name: undefined
		},
		on: {
			SUBMIT: {
				actions: ({ context, event }) => {
					if (context.request !== event.request) event.request.release()
				}
			}
		},
		states: {
			idle: {
				on: {
					SUBMIT: {
						target: 'operation',
						actions: assign({
							request: ({ event }) => event.request,
							binding: undefined,
							previous: undefined,
							native: undefined,
							interruption: undefined,
							result: undefined,
							name: undefined
						})
					},
					DRAIN: {},
					DISMISS: {}
				}
			},
			operation: {
				initial: 'reading',
				invoke: {
					src: 'observe',
					input,
					onError: { actions: raise({ type: 'SCOPE_CHANGED' }) }
				},
				states: {
					reading: {
						invoke: {
							src: 'readFile',
							input,
							onDone: afterLeaf('preparingEnvelope'),
							onError: fail
						}
					},
					preparingEnvelope: {
						invoke: { src: 'prepareEnvelope', input, onDone: afterLeaf('opening'), onError: fail }
					},
					opening: {
						on: {
							CANCEL: { actions: ['interrupt', sendTo('open', { type: 'CANCEL' })] },
							DRAIN: { actions: ['interrupt', sendTo('open', { type: 'SHUTDOWN' })] },
							SCOPE_CHANGED: { actions: ['interrupt', sendTo('open', { type: 'SHUTDOWN' })] }
						},
						invoke: {
							id: 'open',
							src: 'open',
							input: ({ context }) => ({
								request: required(restoreFile(context.request).envelope)
							}),
							onDone: [
								{
									guard: ({ context, event }) =>
										!context.interruption && event.output.outcome === 'integrityChecked',
									target: 'validating',
									actions: ({ context, event }) => {
										if (event.output.outcome === 'integrityChecked')
											restoreFile(context.request).archive = event.output.archive
									}
								},
								{
									target: 'cleaning',
									actions: [
										({ context, event }) => {
											if (event.output.outcome === 'integrityChecked')
												restoreFile(context.request).archive = event.output.archive
										},
										assign({ result: 'failed' })
									]
								}
							],
							onError: fail
						}
					},
					validating: {
						invoke: {
							src: 'validateFile',
							input,
							onDone: afterLeaf('deriving', 'rememberName'),
							onError: fail
						}
					},
					deriving: {
						invoke: {
							src: 'deriveBinding',
							input,
							onDone: afterLeaf('initializingJournal', 'rememberBinding'),
							onError: fail
						}
					},
					initializingJournal: {
						invoke: {
							src: 'journal',
							input: ({ context }) => ({
								binding: required(context.binding),
								databaseName: restoreJournalName,
								command: { mode: 'initialize' }
							}),
							onDone: [
								{ guard: ({ context }) => context.interruption !== undefined, target: 'cleaning' },
								{
									guard: ({ event }) => event.output.outcome === 'initialized',
									target: 'discovering'
								},
								fail
							],
							onError: fail
						}
					},
					discovering: {
						invoke: {
							src: 'journal',
							input: ({ context }) => ({
								binding: required(context.binding),
								databaseName: restoreJournalName,
								command: { mode: 'discover' }
							}),
							onDone: [
								{ guard: ({ context }) => context.interruption !== undefined, target: 'cleaning' },
								{
									guard: ({ context, event }) =>
										event.output.outcome === 'loaded' &&
										event.output.record !== undefined &&
										!matchesRestoreFile(required(context.request), event.output.record),
									...fail
								},
								{
									guard: ({ event }) =>
										event.output.outcome === 'loaded' &&
										event.output.record?.checkpoint.kind === 'complete',
									target: 'cleaning',
									actions: assign({ result: 'done' })
								},
								{
									guard: ({ event }) =>
										(event.output.outcome === 'loaded' &&
											event.output.record?.checkpoint.kind === 'conflict') ||
										event.output.outcome === 'conflict',
									target: 'cleaning',
									actions: assign({ result: 'conflict' })
								},
								{
									guard: ({ event }) =>
										event.output.outcome === 'missing' || event.output.outcome === 'loaded',
									target: 'preparingPlan',
									actions: assign({
										previous: ({ context, event }) => {
											restoreFile(context.request).previous = event.output.record
											return event.output.record
										}
									})
								},
								fail
							],
							onError: fail
						}
					},
					preparingPlan: {
						invoke: { src: 'preparePlan', input, onDone: afterLeaf('planning'), onError: fail }
					},
					planning: {
						on: {
							CANCEL: { actions: ['interrupt', sendTo('planner', { type: 'CANCEL' })] },
							DRAIN: { actions: ['interrupt', sendTo('planner', { type: 'SHUTDOWN' })] },
							SCOPE_CHANGED: { actions: ['interrupt', sendTo('planner', { type: 'SHUTDOWN' })] }
						},
						invoke: {
							id: 'planner',
							src: 'plan',
							input: ({ context }) => ({ request: required(restoreFile(context.request).plan) }),
							onDone: [
								{
									guard: ({ context, event }) =>
										!context.interruption && event.output.outcome === 'planned',
									target: 'review'
								},
								fail
							],
							onError: fail
						}
					},
					review: {
						on: {
							CONFIRM: 'preparingNative',
							CANCEL: { target: 'cleaning', actions: 'interrupt' },
							DRAIN: { target: 'cleaning', actions: 'interrupt' },
							SCOPE_CHANGED: { target: 'cleaning', actions: 'interrupt' }
						}
					},
					preparingNative: {
						invoke: {
							src: 'prepareNative',
							input,
							onDone: [
								{ guard: ({ context }) => context.interruption !== undefined, target: 'cleaning' },
								{
									target: 'restoring',
									actions: assign({
										native: ({ context, spawn }) =>
											spawn(required(restoreFile(context.request).logic), {
												syncSnapshot: true
											})
									})
								}
							],
							onError: fail
						}
					},
					restoring: {
						on: {
							CANCEL: {
								actions: [
									'interrupt',
									sendTo(({ context }) => required(context.native), { type: 'CANCEL' })
								]
							},
							DRAIN: {
								actions: [
									'interrupt',
									sendTo(({ context }) => required(context.native), { type: 'SHUTDOWN' })
								]
							},
							SCOPE_CHANGED: {
								actions: [
									'interrupt',
									sendTo(({ context }) => required(context.native), { type: 'SHUTDOWN' })
								]
							}
						}
					},
					releaseBlocked: {
						on: {
							RETRY_RELEASE: {
								target: 'restoring',
								actions: sendTo(({ context }) => required(context.native), {
									type: 'RETRY_RELEASE'
								})
							},
							CANCEL: {
								actions: [
									'interrupt',
									sendTo(({ context }) => required(context.native), { type: 'CANCEL' })
								]
							},
							DRAIN: {
								actions: [
									'interrupt',
									sendTo(({ context }) => required(context.native), { type: 'SHUTDOWN' })
								]
							},
							SCOPE_CHANGED: {
								actions: [
									'interrupt',
									sendTo(({ context }) => required(context.native), { type: 'SHUTDOWN' })
								]
							}
						}
					},
					restartRequired: {},
					cleaning: {
						invoke: {
							src: 'cleanup',
							input: ({ context }) => context.request,
							onDone: '#workspace-restore-controller.finished',
							onError: 'cleanupBlocked'
						}
					},
					cleanupBlocked: { on: { RETRY_RELEASE: 'cleaning' } }
				},
				on: {
					CANCEL: { actions: 'interrupt' },
					DRAIN: { actions: 'interrupt' },
					SCOPE_CHANGED: { actions: 'interrupt' },
					'xstate.snapshot.*': [
						{
							guard: ({ context, event }) =>
								event.type === `xstate.snapshot.${context.native?.id}` &&
								event.snapshot.hasTag('restore-restart-required'),
							target: '.restartRequired',
							actions: 'fail'
						},
						{
							guard: ({ context, event }) =>
								event.type === `xstate.snapshot.${context.native?.id}` &&
								event.snapshot.hasTag('restore-release-blocked'),
							target: '.releaseBlocked'
						}
					],
					'xstate.done.actor.*': {
						guard: ({ context, event }) => event.actorId === context.native?.id,
						target: '.cleaning',
						actions: [
							model.stopChild(({ context }) => required(context.native)),
							assign({
								native: undefined,
								result: ({ event }) =>
									event.output.record?.checkpoint.kind === 'complete' ||
									event.output.outcome === 'complete'
										? 'done'
										: event.output.outcome === 'conflict'
											? 'conflict'
											: event.output.outcome === 'cancelled'
												? 'cancelled'
												: 'failed'
							})
						]
					},
					'xstate.error.actor.*': {
						guard: ({ context, event }) => event.actorId === context.native?.id,
						target: '.restartRequired',
						actions: assign({ result: 'failed' })
					}
				}
			},
			finished: {
				on: {
					SUBMIT: {
						target: 'operation',
						actions: assign({
							request: ({ event }) => event.request,
							binding: undefined,
							previous: undefined,
							native: undefined,
							interruption: undefined,
							result: undefined,
							name: undefined
						})
					},
					DRAIN: {
						target: 'idle',
						actions: assign({ result: undefined, name: undefined, binding: undefined })
					},
					DISMISS: {
						target: 'idle',
						actions: assign({ result: undefined, name: undefined, binding: undefined })
					},
					OPEN: {
						guard: ({ context }) => context.result === 'done' && context.binding !== undefined,
						target: 'openingDestination'
					}
				}
			},
			openingDestination: {
				invoke: {
					src: 'navigate',
					input: ({ context }) => required(context.binding),
					onDone: 'finished',
					onError: { target: 'finished', actions: assign({ result: 'failed' }) }
				},
				on: { DRAIN: { actions: 'interrupt' }, CANCEL: { actions: 'interrupt' } }
			}
		}
	})
}
function matchesRestoreFile(request: WorkspaceRestoreFile, record: RestoreJournalRecord) {
	const archive = required(restoreFile(request).archive),
		payload = archive.readPayload(),
		intent = record.intent
	return (
		intent.archive.payloadSha256 === archive.payloadDigest() &&
		intent.archive.archiveId === payload.archiveId &&
		canonicalRecovery(intent.archive.profile) === canonicalRecovery(payload.profile) &&
		canonicalRecovery(intent.archive.source) === canonicalRecovery(payload.source)
	)
}
export function selectWorkspaceRestoreReport(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkspaceRestoreController>>
) {
	const context = snapshot.context,
		busy = snapshot.matches('operation') || snapshot.matches('openingDestination'),
		review = snapshot.matches({ operation: 'review' }),
		blocked =
			snapshot.matches({ operation: 'releaseBlocked' }) ||
			snapshot.matches({ operation: 'cleanupBlocked' }),
		restartRequired = snapshot.matches({ operation: 'restartRequired' })
	const result =
		context.result === 'done' && context.interruption !== 'invalidated'
			? 'done'
			: context.interruption === 'cancelled'
				? 'cancelled'
				: context.interruption === 'invalidated'
					? undefined
					: context.result
	const view: WorkspaceRestoreView = {
		...emptyWorkspaceRestoreView,
		busy,
		editable: !busy,
		canConfirm: review,
		confirmAction: context.previous ? 'retry' : 'create',
		canCancel:
			busy &&
			!blocked &&
			!restartRequired &&
			!snapshot.matches({ operation: 'cleaning' }) &&
			!snapshot.matches('openingDestination'),
		canRetryRelease: blocked,
		canReload: restartRequired,
		canOpen: !busy && result === 'done' && context.binding !== undefined,
		visibleOutsideSettings: busy || result !== undefined,
		message: busy
			? review
				? undefined
				: blocked || restartRequired
					? 'failed'
					: snapshot.matches({ operation: 'restoring' })
						? 'restoring'
						: 'preparing'
			: result,
		workspaceName: context.name,
		workspaceId: context.binding?.workspaceId,
		identityId: context.binding?.identityId
	}
	view.alert = view.message === 'failed' || view.message === 'conflict'
	return { request: context.request, view }
}
