import { assign, fromPromise, setup } from 'xstate'
import { z } from 'zod'
import { schema as s } from 'jazz-tools'
import type { IntegrityCheckedArchive } from 'delightful-local-first/backup/envelope'
import type { ArchivePayload } from 'delightful-local-first/backup/archive'
import type { BackupBinding } from 'delightful-local-first/backup/binding'
import { sameBackupBinding } from 'delightful-local-first/backup/binding'
import {
	createRestoreJournalRecord,
	type RestoreJournalIntent
} from 'delightful-local-first/backup/restore/journal'
import { decodeFinanceBackup } from '../../backup/workspace.js'
import {
	app,
	type Organization,
	type Account,
	type Category,
	type Tag,
	type TransactionRow,
	type InternalTransfer
} from '../../schema.js'
import { stableUuid } from '../../domain/stable-uuid.js'

/** Typed restore plan; no destination client, writes or access grants are acquired here. */
export type FinanceRestoreGraph = {
	workspace: Organization
	accounts: (Omit<Account, 'archivedAt'> & { archivedAt: string | null })[]
	categories: (Omit<Category, 'archivedAt'> & { archivedAt: string | null })[]
	tags: (Omit<Tag, 'archivedAt'> & { archivedAt: string | null })[]
	transactions: TransactionRow[]
	transfers: InternalTransfer[]
	checks: s.RowOf<typeof app.checks>[]
	transactionTags: s.RowOf<typeof app.transactionTags>[]
	batches: s.RowOf<typeof app.transactionBatches>[]
	templates: s.RowOf<typeof app.batchTemplates>[]
	files: s.RowOf<typeof app.files>[]
	links: s.RowOf<typeof app.transactionAttachments>[]
	parts: { id: string; fileId: string; partIndex: number; sizeBytes: number; data: number[] }[]
	member: s.RowOf<typeof app.organizationMembers>
	source: {
		file: s.RowOf<typeof app.files>
		parts: Omit<s.RowOf<typeof app.fileParts>, 'data'>[]
	}
}
export type FinanceRestorePlan = { graph: FinanceRestoreGraph; intent: RestoreJournalIntent }
export type FinanceRestorePlanRequest = {
	toJSON(): { kind: 'financeRestorePlan' }
	read(): FinanceRestorePlan
	release(): void
}
const compare = (left: string, right: string) => (left === right ? 0 : left < right ? -1 : 1)
export function canonicalRecovery(value: unknown): string {
	if (value instanceof Date) return JSON.stringify(value.toISOString())
	if (value instanceof Uint8Array) return canonicalRecovery([...value])
	if (Array.isArray(value)) return '[' + value.map(canonicalRecovery).join(',') + ']'
	if (value && typeof value === 'object')
		return (
			'{' +
			Object.entries(value)
				.sort(([a], [b]) => compare(a, b))
				.map(([key, item]) => JSON.stringify(key) + ':' + canonicalRecovery(item))
				.join(',') +
			'}'
		)
	const encoded = JSON.stringify(value)
	if (encoded === undefined) throw new Error('Unsupported restore value')
	return encoded
}
export const digestRecovery = (value: unknown) =>
	crypto.subtle
		.digest('SHA-256', new TextEncoder().encode(canonicalRecovery(value)))
		.then((digest) =>
			[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
		)
export const financeGraphRows = (graph: FinanceRestoreGraph) => [
	graph.accounts,
	graph.categories,
	graph.tags,
	graph.checks,
	graph.batches,
	graph.templates,
	graph.transactions,
	graph.transactionTags,
	graph.transfers,
	graph.files,
	graph.links,
	graph.parts
]
type Decoded = ReturnType<typeof decodeFinanceBackup>
type PlanDraft = Omit<RestoreJournalIntent['plan'], 'sha256'>
type PrivatePlan = {
	archive: IntegrityCheckedArchive
	binding: BackupBinding
	previous: RestoreJournalIntent | undefined
	payload?: ArchivePayload
	sourceSize?: number
	decoded?: Decoded
	mappings?: RestoreJournalIntent['plan']['mappings']
	ids?: Map<string, string>
	graph?: FinanceRestoreGraph
	graphHash?: string
	draft?: PlanDraft
	planHash?: string
	plan?: FinanceRestorePlan
}
const plans = new WeakMap<FinanceRestorePlanRequest, PrivatePlan>()
function data(request: FinanceRestorePlanRequest) {
	const value = plans.get(request)
	if (!value) throw new Error('Released restore plan')
	return value
}
export function prepareFinanceRestorePlan(
	archive: IntegrityCheckedArchive,
	binding: BackupBinding,
	previous?: RestoreJournalIntent
): FinanceRestorePlanRequest {
	const request: FinanceRestorePlanRequest = {
		toJSON: () => ({ kind: 'financeRestorePlan' }),
		read: () => {
			const plan = data(request).plan
			if (!plan) throw new Error('Restore plan is not ready')
			return plan
		},
		release: () => {
			const graph = plans.get(request)?.graph
			for (const part of graph?.parts ?? []) part.data.fill(0)
			plans.delete(request)
		}
	}
	plans.set(request, { archive, binding: { ...binding }, previous })
	return request
}
const key = (kind: string, type: string, id: string) => JSON.stringify([kind, type, id])
const partKey = (id: string, index: number) => key('part', id, String(index))
export const restorePartBytes = 256 * 1024
const partBytes = restorePartBytes
const sourceIdentity = (archiveId: string) => 'payload/' + archiveId
function decode(request: FinanceRestorePlanRequest) {
	const value = data(request),
		payload = value.archive.readPayload(),
		{ binding, previous } = value
	z.uuid().parse(binding.identityId)
	z.uuid().parse(binding.operationId)
	if (binding.workspaceId !== payload.source.workspaceId) throw new Error('Restore source mismatch')
	if (
		previous &&
		(previous.operation.applicationId !== binding.applicationId ||
			previous.operation.environment !== binding.environment ||
			previous.operation.identityId !== binding.identityId ||
			previous.operation.operationId !== binding.operationId ||
			previous.archive.payloadSha256 !== value.archive.payloadDigest() ||
			previous.archive.archiveId !== payload.archiveId ||
			canonicalRecovery(previous.archive.profile) !== canonicalRecovery(payload.profile) ||
			canonicalRecovery(previous.archive.source) !== canonicalRecovery(payload.source))
	)
		throw new Error('Restore intent mismatch')
	value.decoded = decodeFinanceBackup(payload)
	value.payload = payload
	const bytes = value.archive.copyPayloadBytes()
	value.sourceSize = bytes.byteLength
	bytes.fill(0)
}
async function derive(request: FinanceRestorePlanRequest) {
	const value = data(request),
		{ payload, binding, previous, sourceSize } = value
	if (!payload || sourceSize === undefined) throw new Error('Missing restore payload')
	const attachments = financialAttachments(value)
	const sources = [
		...payload.records.map((row) => ({ kind: 'record', type: row.type, sourceId: row.id })),
		...attachments.map((file) => ({ kind: 'attachment', type: '', sourceId: file.id }))
	].sort((a, b) => compare(key(a.kind, a.type, a.sourceId), key(b.kind, b.type, b.sourceId)))
	const saved = previous?.plan.mappings
	if (
		saved &&
		(saved.length !== sources.length ||
			sources.some((source, index) => {
				const old = saved[index]
				return (
					!old ||
					old.kind !== source.kind ||
					old.sourceId !== source.sourceId ||
					(old.kind !== 'attachment' && old.type !== source.type)
				)
			}))
	)
		throw new Error('Restore mapping set mismatch')
	const names = [
		...sources.map((source) => key(source.kind, source.type, source.sourceId)),
		'owner-membership',
		'source-payload',
		...Array.from({ length: Math.ceil(sourceSize / partBytes) }, (_, index) =>
			partKey(sourceIdentity(payload.archiveId), index)
		),
		...attachments.flatMap((file) =>
			Array.from({ length: Math.ceil(file.sizeBytes / partBytes) }, (_, index) =>
				partKey(file.id, index)
			)
		)
	]
	const entries = await Promise.all(
		names.map(
			async (name) => [name, await stableUuid(binding.operationId, name)] satisfies [string, string]
		)
	)
	const ids = new Map(entries)
	const mappings = sources.map((source, index) => {
		const destinationId =
			saved?.[index]?.destinationId ?? ids.get(key(source.kind, source.type, source.sourceId))
		if (!destinationId) throw new Error('Missing restore mapping')
		z.uuid().parse(destinationId)
		ids.set(key(source.kind, source.type, source.sourceId), destinationId)
		if (source.kind === 'attachment')
			return {
				kind: 'attachment',
				sourceId: source.sourceId,
				destinationId
			} satisfies RestoreJournalIntent['plan']['mappings'][number]
		return {
			kind: 'record',
			type: source.type,
			sourceId: source.sourceId,
			destinationId
		} satisfies RestoreJournalIntent['plan']['mappings'][number]
	})
	// Late crypto cannot republish a released plan.
	if (plans.has(request)) {
		value.mappings = mappings
		value.ids = ids
	}
}
type SourceAudit = Pick<
	Decoded['organizations'][number],
	| 'sourceCreatedAt'
	| 'sourceUpdatedAt'
	| 'sourceCreatedBy'
	| 'sourceUpdatedBy'
	| 'sourceCreatedIssuer'
	| 'sourceCreatedSubject'
	| 'sourceUpdatedIssuer'
	| 'sourceUpdatedSubject'
>
function business<Row extends SourceAudit>(row: Row) {
	const {
		sourceCreatedAt: _ca,
		sourceUpdatedAt: _ua,
		sourceCreatedBy: _cb,
		sourceUpdatedBy: _ub,
		sourceCreatedIssuer: _ci,
		sourceCreatedSubject: _cs,
		sourceUpdatedIssuer: _ui,
		sourceUpdatedSubject: _us,
		...domain
	} = row
	return domain
}
const ordered = <Row extends { id: string }>(rows: Row[]) =>
	rows.sort((a, b) => compare(a.id, b.id))
function financialAttachments(value: PrivatePlan) {
	if (!value.payload || !value.decoded) throw new Error('Missing decoded restore rows')
	const ids = new Set(value.decoded.files.map((file) => file.id))
	return value.payload.attachments.filter((file) => ids.has(file.id))
}
function project(request: FinanceRestorePlanRequest) {
	const value = data(request),
		{ decoded: rows, ids, payload, binding } = value
	if (!rows || !ids || !payload || !value.sourceSize)
		throw new Error('Missing decoded restore rows')
	const mapped = (type: string, id: string) => {
		const result = ids.get(key('record', type, id))
		if (!result) throw new Error('Unmapped restore reference')
		return result
	}
	const optional = (type: string, id: string | null) => (id === null ? null : mapped(type, id))
	const physical = (name: string) => {
		const id = ids.get(name)
		if (!id) throw new Error('Missing physical restore ID')
		return id
	}
	const root = rows.organizations[0]
	if (!root) throw new Error('Missing restore workspace')
	const workspaceId = mapped('organizations', root.id)
	const sourceId = sourceIdentity(payload.archiveId),
		sourceFileId = physical('source-payload'),
		sourceSize = value.sourceSize
	const graph: FinanceRestoreGraph = {
		source: {
			file: {
				id: sourceFileId,
				transactionId: null,
				accountId: null,
				organizationId: workspaceId,
				fileName: 'source-' + payload.archiveId + '.json',
				mimeType: 'application/json',
				sizeBytes: sourceSize
			},
			parts: Array.from({ length: Math.ceil(sourceSize / partBytes) }, (_, index) => ({
				id: physical(partKey(sourceId, index)),
				fileId: sourceFileId,
				partIndex: index,
				sizeBytes: Math.min(partBytes, sourceSize - index * partBytes)
			}))
		},
		workspace: { ...business(root), id: workspaceId, ownerId: binding.identityId },
		accounts: ordered(
			rows.accounts.map((row) => ({
				...business(row),
				id: mapped('accounts', row.id),
				organizationId: workspaceId,
				archivedAt: row.archivedAt?.toISOString() ?? null
			}))
		),
		categories: ordered(
			rows.categories.map((row) => ({
				...business(row),
				id: mapped('categories', row.id),
				organizationId: workspaceId,
				archivedAt: row.archivedAt?.toISOString() ?? null
			}))
		),
		tags: ordered(
			rows.tags.map((row) => ({
				...business(row),
				id: mapped('tags', row.id),
				organizationId: workspaceId,
				categoryId: optional('categories', row.categoryId),
				archivedAt: row.archivedAt?.toISOString() ?? null
			}))
		),
		checks: ordered(
			rows.checks.map((row) => ({
				...business(row),
				id: mapped('checks', row.id),
				organizationId: workspaceId,
				accountId: mapped('accounts', row.accountId)
			}))
		),
		batches: ordered(
			rows.transactionBatches.map((row) => ({
				...business(row),
				id: mapped('transactionBatches', row.id),
				organizationId: workspaceId
			}))
		),
		templates: ordered(
			rows.batchTemplates.map((row) => ({
				...business(row),
				id: mapped('batchTemplates', row.id),
				organizationId: workspaceId
			}))
		),
		transactions: ordered(
			rows.transactions.map((row) => ({
				...business(row),
				id: mapped('transactions', row.id),
				organizationId: workspaceId,
				accountId: mapped('accounts', row.accountId),
				categoryId: mapped('categories', row.categoryId),
				checkId: optional('checks', row.checkId),
				batchId: optional('transactionBatches', row.batchId),
				internalTransferId: optional('internalTransfers', row.internalTransferId)
			}))
		),
		transactionTags: ordered(
			rows.transactionTags.map((row) => ({
				...business(row),
				id: mapped('transactionTags', row.id),
				organizationId: workspaceId,
				transactionId: mapped('transactions', row.transactionId),
				tagId: mapped('tags', row.tagId)
			}))
		),
		transfers: ordered(
			rows.internalTransfers.map((row) => ({
				...business(row),
				id: mapped('internalTransfers', row.id),
				organizationId: workspaceId,
				expenseTransactionId: mapped('transactions', row.expenseTransactionId),
				incomeTransactionId: mapped('transactions', row.incomeTransactionId),
				expenseAccountId: optional('accounts', row.expenseAccountId),
				incomeAccountId: optional('accounts', row.incomeAccountId)
			}))
		),
		files: ordered(
			rows.files.map((row) => ({
				...business(row),
				id: mapped('files', row.id),
				transactionId: mapped('transactions', row.transactionId),
				organizationId: optional('organizations', row.organizationId),
				accountId: optional('accounts', row.accountId)
			}))
		),
		links: ordered(
			rows.transactionAttachments.map((row) => ({
				...business(row),
				id: mapped('transactionAttachments', row.id),
				transactionId: mapped('transactions', row.transactionId),
				fileId: mapped('files', row.fileId)
			}))
		),
		parts: financialAttachments(value)
			.flatMap((file) => {
				const raw = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))
				return Array.from({ length: Math.ceil(raw.length / partBytes) }, (_, index) => ({
					id: physical(partKey(file.id, index)),
					fileId: mapped('files', file.id),
					partIndex: index,
					sizeBytes: Math.min(partBytes, raw.length - index * partBytes),
					data: [...raw.subarray(index * partBytes, (index + 1) * partBytes)]
				}))
			})
			.sort((a, b) => compare(a.fileId, b.fileId) || a.partIndex - b.partIndex),
		member: {
			id: physical('owner-membership'),
			organizationId: workspaceId,
			userId: binding.identityId,
			profileId: null,
			role: 'owner',
			accountAccessMode: 'all'
		}
	}
	// Physical rows must not collide with mapped rows or any archived source ID.
	const sources = new Set(
		[...payload.records, ...payload.references, ...payload.attachments].map((row) => row.id)
	)
	const destinations = [
		...(value.mappings ?? []).map((row) => row.destinationId),
		graph.member.id,
		graph.source.file.id,
		...graph.parts.map((row) => row.id),
		...graph.source.parts.map((row) => row.id)
	]
	if (
		new Set(destinations).size !== destinations.length ||
		destinations.some((id) => sources.has(id))
	)
		throw new Error('Restore identity collision')
	value.graph = graph
}
function draft(request: FinanceRestorePlanRequest, hashes: string[]) {
	const value = data(request),
		{ mappings, graphHash, graph, binding } = value
	const [preparation, financial, activation] = hashes
	if (!mappings || !graph || !graphHash || !preparation || !financial || !activation)
		throw new Error('Incomplete restore hashes')
	const indexes = mappings.map((row, index) => ({ row, index }))
	const financialIndexes = indexes
		.filter(({ row }) => !(row.kind === 'record' && row.type === 'organizations'))
		.map(({ index }) => index)
	value.draft = {
		id: binding.operationId,
		version: 1,
		expectedGraphSha256: graphHash,
		mappings,
		preparation: {
			writeId: 'preparation',
			expectedContentSha256: preparation,
			mappingIndexes: indexes
				.filter(({ row }) => row.kind === 'record' && row.type === 'organizations')
				.map(({ index }) => index)
		},
		batches: financialIndexes.length
			? [
					{
						writeId: 'financial-graph',
						expectedContentSha256: financial,
						mappingIndexes: financialIndexes
					}
				]
			: [],
		activation: { writeId: 'activation', expectedContentSha256: activation },
		requirements: { local: 'notRequired', remote: 'required' }
	}
}
function finish(request: FinanceRestorePlanRequest) {
	const value = data(request),
		{ graph, payload, binding, planHash, draft, previous } = value
	if (!graph || !payload || !planHash || !draft) throw new Error('Incomplete restore plan')
	const intent: RestoreJournalIntent = {
		operation: {
			applicationId: binding.applicationId,
			environment: binding.environment,
			identityId: binding.identityId,
			operationId: binding.operationId,
			destinationWorkspaceId: graph.workspace.id
		},
		archive: {
			archiveId: payload.archiveId,
			payloadSha256: value.archive.payloadDigest(),
			profile: payload.profile,
			source: payload.source
		},
		plan: { ...draft, sha256: planHash }
	}
	createRestoreJournalRecord(intent)
	if (previous && canonicalRecovery(previous) !== canonicalRecovery(intent))
		throw new Error('Rebuilt restore plan mismatch')
	value.plan = { graph, intent }
}
type PlanningInput = { request: FinanceRestorePlanRequest }
type PlanningResult =
	{ outcome: 'planned'; plan: FinanceRestorePlanRequest } | { outcome: 'failed' | 'cancelled' }
const actors = {
	decode: fromPromise<void, PlanningInput>(({ input }) =>
		Promise.resolve().then(() => decode(input.request))
	),
	derive: fromPromise<void, PlanningInput>(({ input }) => derive(input.request)),
	project: fromPromise<void, PlanningInput>(({ input }) =>
		Promise.resolve().then(() => project(input.request))
	),
	hashGraph: fromPromise<string, PlanningInput>(({ input }) =>
		digestRecovery(data(input.request).graph)
	),
	hashWrites: fromPromise<string[], PlanningInput>(({ input }) => {
		const graph = data(input.request).graph
		if (!graph) throw new Error('Missing restore graph')
		return Promise.all([
			digestRecovery([graph.workspace, graph.source, data(input.request).archive.payloadDigest()]),
			digestRecovery([
				financeGraphRows(graph),
				graph.source,
				data(input.request).archive.payloadDigest()
			]),
			digestRecovery(graph.member)
		])
	}),
	hashPlan: fromPromise<string, PlanningInput>(({ input }) =>
		digestRecovery(data(input.request).draft)
	),
	finish: fromPromise<void, PlanningInput>(({ input }) =>
		Promise.resolve().then(() => finish(input.request))
	)
}
export const financeRestorePlanningMachine = setup<
	PlanningInput & { result: PlanningResult },
	{ type: 'CANCEL' | 'SHUTDOWN' } | { type: 'INVALIDATE'; binding: BackupBinding },
	typeof actors,
	{},
	{},
	{},
	never,
	string,
	PlanningInput,
	PlanningResult
>({ actors }).createMachine({
	context: ({ input }) => ({ ...input, result: { outcome: 'failed' } }),
	initial: 'decoding',
	output: ({ context }) => context.result,
	on: {
		CANCEL: { target: '.cancelled' },
		SHUTDOWN: { target: '.cancelled' },
		INVALIDATE: {
			guard: ({ context, event }) =>
				sameBackupBinding(data(context.request).binding, event.binding),
			target: '.cancelled'
		}
	},
	states: {
		decoding: {
			invoke: {
				src: 'decode',
				input: ({ context }) => context,
				onDone: 'derivingIds',
				onError: 'failed'
			}
		},
		derivingIds: {
			invoke: {
				src: 'derive',
				input: ({ context }) => context,
				onDone: 'projecting',
				onError: 'failed'
			}
		},
		projecting: {
			invoke: {
				src: 'project',
				input: ({ context }) => context,
				onDone: 'fingerprintingGraph',
				onError: 'failed'
			}
		},
		fingerprintingGraph: {
			invoke: {
				src: 'hashGraph',
				input: ({ context }) => context,
				onDone: {
					target: 'fingerprintingWrites',
					actions: ({ context, event }) => {
						data(context.request).graphHash = event.output
					}
				},
				onError: 'failed'
			}
		},
		fingerprintingWrites: {
			invoke: {
				src: 'hashWrites',
				input: ({ context }) => context,
				onDone: {
					target: 'fingerprintingPlan',
					actions: ({ context, event }) => draft(context.request, event.output)
				},
				onError: 'failed'
			}
		},
		fingerprintingPlan: {
			invoke: {
				src: 'hashPlan',
				input: ({ context }) => context,
				onDone: {
					target: 'validatingIntent',
					actions: ({ context, event }) => {
						data(context.request).planHash = event.output
					}
				},
				onError: 'failed'
			}
		},
		validatingIntent: {
			invoke: {
				src: 'finish',
				input: ({ context }) => context,
				onDone: 'planned',
				onError: 'failed'
			}
		},
		planned: {
			type: 'final',
			entry: assign({ result: ({ context }) => ({ outcome: 'planned', plan: context.request }) })
		},
		failed: { type: 'final', entry: ({ context }) => context.request.release() },
		cancelled: {
			type: 'final',
			entry: [
				({ context }) => context.request.release(),
				assign({ result: { outcome: 'cancelled' } })
			]
		}
	}
})
