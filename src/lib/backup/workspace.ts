import { z } from 'zod'
import type { QueryBuilder } from 'jazz-tools'
import type {
	JazzArchiveReaderInput,
	JazzExportErrorCode
} from 'delightful-local-first/backend/jazz/backup'
import type {
	ArchivePayload,
	ArchiveRecord,
	ArchiveValue,
	ArchiveAttachment
} from 'delightful-local-first/backup/archive'
import { app } from '../schema.js'
import { currencyText, dateOnlyText } from '../validation/transactions.js'
import { syncOutcome, syncSettlement, syncFailureCode } from '../validation/bank-sync-log.js'

const id = z.uuid(),
	text = z.string(),
	integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const kind = z.enum(['income', 'expense'])
const counts = {
	importedCount: integer.nullable(),
	existingCount: integer.nullable(),
	omittedCount: integer.nullable()
}
const audit = {
	sourceCreatedAt: z.date().nullable(),
	sourceUpdatedAt: z.date().nullable(),
	sourceCreatedBy: id.nullable(),
	sourceUpdatedBy: id.nullable(),
	sourceCreatedIssuer: text.nullable(),
	sourceCreatedSubject: text.nullable(),
	sourceUpdatedIssuer: text.nullable(),
	sourceUpdatedSubject: text.nullable()
}
const author = z.object({ account: id, identity: z.object({ issuer: text, subject: text }) })
const row = <Shape extends z.ZodRawShape>(shape: Shape) => z.object({ id, ...shape, ...audit })
const check = {
	organizationId: id,
	accountId: id,
	checkNumber: text,
	checkDate: dateOnlyText,
	payerName: text.nullable(),
	bankName: text.nullable(),
	memoOnCheck: text.nullable()
}
/** Explicit released-field allowlist. Secret columns, avatars and operational jobs never enter it. */
const rows = {
	organizations: row({
		name: text.min(1),
		kind: z.enum(['personal', 'business']),
		defaultCurrency: currencyText,
		ownerId: id
	}),
	organizationMembers: row({
		organizationId: id,
		userId: id,
		profileId: id.nullable(),
		role: z.enum(['owner', 'admin', 'member', 'viewer']),
		accountAccessMode: z.enum(['all', 'selected'])
	}),
	profiles: row({ userId: id, displayName: text.nullable() }),
	accounts: row({
		organizationId: id,
		name: text.min(1),
		kind: z.enum(['cash', 'bank', 'card']),
		currency: currencyText,
		archivedAt: z.date().nullable()
	}),
	accountMemberships: row({
		organizationId: id,
		userId: id,
		accountId: id,
		access: z.enum(['read', 'write']),
		canDelete: z.boolean()
	}),
	categories: row({
		organizationId: id,
		name: text.min(1),
		kind,
		isSystem: z.boolean(),
		archivedAt: z.date().nullable()
	}),
	tags: row({
		organizationId: id,
		name: text.min(1),
		kind,
		categoryId: id.nullable(),
		archivedAt: z.date().nullable()
	}),
	transactions: row({
		organizationId: id,
		accountId: id,
		categoryId: id,
		amountMinor: integer,
		kind,
		currency: currencyText,
		bookedOn: dateOnlyText,
		description: text.nullable(),
		memo: text.nullable(),
		paymentMethod: z.enum(['cash', 'check', 'transfer', 'electronic']).nullable(),
		checkId: id.nullable(),
		checkDetailsId: z.null(),
		internalTransferId: id.nullable(),
		source: z.enum(['manual', 'simplefin']),
		externalId: text.nullable(),
		batchId: id.nullable()
	}),
	transactionTags: row({ organizationId: id, transactionId: id, tagId: id }),
	checks: row(check),
	internalTransfers: row({
		organizationId: id,
		expenseTransactionId: id,
		incomeTransactionId: id,
		expenseAccountId: id.nullable(),
		incomeAccountId: id.nullable(),
		expenseAmountMinor: integer.nullable(),
		incomeAmountMinor: integer.nullable(),
		expenseCurrency: currencyText.nullable(),
		incomeCurrency: currencyText.nullable(),
		amountMinor: integer.nullable(),
		currency: currencyText.nullable()
	}),
	transactionBatches: row({ organizationId: id, name: text.nullable() }),
	batchTemplates: row({ organizationId: id, name: text }),
	transactionAttachments: row({ transactionId: id, fileId: id }),
	files: row({
		transactionId: id,
		accountId: id.nullable(),
		organizationId: id.nullable(),
		fileName: text,
		mimeType: text.min(1),
		sizeBytes: integer
	}),
	simplefinConnections: row({
		organizationId: id,
		ownerId: id.nullable(),
		status: z.enum(['active', 'error', 'revoked']),
		claimedAt: z.date(),
		lastSyncAt: z.date().nullable(),
		lastOutcome: z.enum(['succeeded', 'partial', 'failed']).nullable(),
		...counts
	}),
	simplefinAccountLinks: row({
		organizationId: id,
		accountId: id,
		connectionId: id.nullable(),
		simplefinAccountId: text,
		simplefinOrgId: text.nullable(),
		availableBalance: text.nullable(),
		balanceDate: z.date().nullable()
	}),
	simplefinSyncAttempts: row({
		organizationId: id,
		connectionId: id,
		initiatedBy: id,
		startedAt: z.date(),
		finishedAt: z.date().nullable(),
		outcome: syncOutcome,
		importSettlement: syncSettlement,
		failureCode: syncFailureCode.nullable(),
		...counts
	}),
	simplefinSyncAccountResults: row({
		organizationId: id,
		attemptId: id,
		accountId: id,
		accountName: text,
		outcome: syncOutcome,
		failureCode: syncFailureCode.nullable(),
		...counts
	})
}
type RowType = keyof typeof rows
type PlainRow = Record<string, unknown> & { id: string }
const inert = new Set<string>([
	'organizationMembers',
	'accountMemberships',
	'profiles',
	'simplefinConnections',
	'simplefinAccountLinks',
	'simplefinSyncAttempts',
	'simplefinSyncAccountResults'
])
const targets: Record<string, string> = {
	organizationId: 'organizations',
	accountId: 'accounts',
	categoryId: 'categories',
	profileId: 'profiles',
	transactionId: 'transactions',
	tagId: 'tags',
	checkId: 'checks',
	internalTransferId: 'internalTransfers',
	batchId: 'transactionBatches',
	fileId: 'files',
	expenseTransactionId: 'transactions',
	incomeTransactionId: 'transactions',
	expenseAccountId: 'accounts',
	incomeAccountId: 'accounts',
	connectionId: 'simplefinConnections',
	attemptId: 'simplefinSyncAttempts'
}
const dateFields = new Set(['bookedOn', 'checkDate'])
const auditColumns: ['$createdAt', '$updatedAt', '$createdBy', '$updatedBy'] = [
	'$createdAt',
	'$updatedAt',
	'$createdBy',
	'$updatedBy'
]
export function backupFailure(code: JazzExportErrorCode): Error {
	return Object.assign(new Error(code), { name: 'JazzExportError', code })
}
function invalid(): never {
	throw backupFailure('invalidData')
}
function knownType(type: string): type is RowType {
	return Object.hasOwn(rows, type)
}
function typeOf(type: string): RowType {
	if (!knownType(type)) return invalid()
	return type
}
function scalar(name: string, value: unknown): ArchiveValue {
	if (value === null) return { kind: 'null' }
	if (targets[name] && typeof value === 'string')
		return { kind: 'reference', type: targets[name], id: value }
	if (value instanceof Date) return { kind: 'timestamp', value: value.toISOString() }
	if (typeof value === 'string') return { kind: dateFields.has(name) ? 'date' : 'text', value }
	if (typeof value === 'boolean') return { kind: 'boolean', value }
	if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0))
		return { kind: 'integer', value: String(value) }
	return invalid()
}
function plain(record: ArchiveRecord): PlainRow {
	return {
		id: record.id,
		...Object.fromEntries(
			Object.entries(record.fields)
				.filter(([name]) => name !== 'originalBytes')
				.map(([name, value]) => [
					name,
					value.kind === 'null'
						? null
						: value.kind === 'reference'
							? value.id
							: value.kind === 'timestamp'
								? new Date(value.value)
								: value.kind === 'integer'
									? Number(value.value)
									: value.kind === 'attachment'
										? invalid()
										: value.value
				])
		)
	}
}
function project(type: RowType, parsed: PlainRow): ArchiveRecord {
	const fields = Object.fromEntries(
		Object.entries(parsed)
			.filter(([name]) => name !== 'id')
			.map(([name, value]) => [name, scalar(name, value)])
	)
	if (type === 'files') fields.originalBytes = { kind: 'attachment', id: parsed.id }
	return { type, id: parsed.id, fields }
}
/** Pure profile validation, also used after independently opening a retained file. */
export function validateFinanceBackup(payload: ArchivePayload): boolean {
	try {
		if (
			payload.profile.id !== 'delightful.finance.workspace' ||
			payload.profile.version !== 1 ||
			payload.source.applicationId !== 'delightful-finances' ||
			payload.coverage.consistency !== 'jazz-exclusive-transaction'
		)
			return false
		if (
			payload.coverage.recordTypes.length !== Object.keys(rows).length ||
			!Object.keys(rows).every((type) => payload.coverage.recordTypes.includes(type))
		)
			return false
		const groups = new Map<string, Map<string, PlainRow>>()
		const referenceRecords = new Set(payload.references),
			attachments = new Map(payload.attachments.map((file) => [file.id, file])),
			linkedFiles = new Set(
				[...payload.records, ...payload.references]
					.filter((row) => row.type === 'transactionAttachments')
					.map((row) => {
						const value = plain(row)
						return String(value.fileId) + '/' + String(value.transactionId)
					})
			)
		for (const record of [...payload.records, ...payload.references]) {
			const type = typeOf(record.type)
			if (inert.has(type) !== referenceRecords.has(record)) return false
			const decoded = plain(record),
				parsed = rows[type].strict().parse(decoded),
				canonical = project(type, parsed)
			if (
				Object.keys(record.fields).length !== Object.keys(canonical.fields).length ||
				Object.entries(canonical.fields).some(
					([name, value]) => JSON.stringify(record.fields[name]) !== JSON.stringify(value)
				)
			)
				return false
			const group = groups.get(type) ?? new Map<string, PlainRow>()
			if (group.has(record.id)) return false
			group.set(record.id, parsed)
			groups.set(type, group)
		}
		const roots = groups.get('organizations'),
			root = roots?.get(payload.source.workspaceId)
		if (roots?.size !== 1 || !root) return false
		const get = (type: string, value: unknown) =>
			typeof value === 'string' ? groups.get(type)?.get(value) : undefined
		for (const [type, group] of groups)
			for (const value of group.values()) {
				if (
					type !== 'organizations' &&
					value.organizationId != null &&
					value.organizationId !== root.id
				)
					return false
				for (const [name, target] of Object.entries(targets))
					if (value[name] != null && !get(target, value[name])) return false
				if (
					type === 'organizationMembers' &&
					value.profileId &&
					get('profiles', value.profileId)?.userId !== value.userId
				)
					return false
				if (type === 'transactions') {
					const account = get('accounts', value.accountId),
						category = get('categories', value.categoryId),
						check = get('checks', value.checkId)
					if (
						account?.currency !== value.currency ||
						category?.kind !== value.kind ||
						(value.source === 'simplefin' && !value.externalId)
					)
						return false
					if (value.internalTransferId) {
						const transfer = get('internalTransfers', value.internalTransferId)
						if (
							transfer?.[
								value.kind === 'expense' ? 'expenseTransactionId' : 'incomeTransactionId'
							] !== value.id
						)
							return false
					}
					if (
						(value.paymentMethod === 'check') !== Boolean(value.checkId) ||
						(check && check.accountId !== value.accountId)
					)
						return false
				}
				if (
					type === 'tags' &&
					value.categoryId &&
					get('categories', value.categoryId)?.kind !== value.kind
				)
					return false
				if (type === 'transactionTags') {
					const tx = get('transactions', value.transactionId),
						tag = get('tags', value.tagId)
					if (tx?.kind !== tag?.kind || (tag?.categoryId && tag.categoryId !== tx?.categoryId))
						return false
				}
				if (
					type === 'transactionAttachments' &&
					get('files', value.fileId)?.transactionId !== value.transactionId
				)
					return false
				if (type === 'files') {
					const tx = get('transactions', value.transactionId)
					if (
						!tx ||
						(value.accountId && value.accountId !== tx.accountId) ||
						!linkedFiles.has(value.id + '/' + String(value.transactionId))
					)
						return false
					const file = attachments.get(value.id)
					if (
						!file ||
						file.fileName !== value.fileName ||
						file.mediaType !== value.mimeType ||
						file.sizeBytes !== value.sizeBytes
					)
						return false
				}
				if (type === 'internalTransfers') {
					const expense = get('transactions', value.expenseTransactionId),
						income = get('transactions', value.incomeTransactionId)
					if (expense?.kind !== 'expense' || income?.kind !== 'income' || expense.id === income.id)
						return false
					if (
						(expense.internalTransferId !== value.id || income.internalTransferId !== value.id) &&
						(expense.internalTransferId !== null || income.internalTransferId !== null)
					)
						return false
					for (const [side, tx] of [
						['expense', expense],
						['income', income]
					] satisfies [string, PlainRow][]) {
						if (value[side + 'AccountId'] != null && value[side + 'AccountId'] !== tx.accountId)
							return false
						if (
							(value[side + 'AmountMinor'] ?? value.amountMinor) !== tx.amountMinor ||
							(value[side + 'Currency'] ?? value.currency) !== tx.currency
						)
							return false
					}
				}
				if (
					type === 'simplefinSyncAttempts' &&
					((value.outcome === 'unfinished') !== (value.finishedAt === null) ||
						(value.finishedAt instanceof Date &&
							value.startedAt instanceof Date &&
							value.finishedAt < value.startedAt))
				)
					return false
			}
		if (
			payload.attachments.length !== (groups.get('files')?.size ?? 0) ||
			payload.attachments.some((file) => !get('files', file.id))
		)
			return false
		return true
	} catch {
		return false
	}
}
export const financeBackupProfile = {
	id: 'delightful.finance.workspace',
	version: 1,
	validate: validateFinanceBackup
}
type PrivateRead = {
	rows: Map<RowType, PlainRow[]>
	parts: Map<string, { id: string; fileId: string; partIndex: number; sizeBytes: number }[]>
	attachments: ArchiveAttachment[]
	bytes: Uint8Array | undefined
	fileIndex: number
	partIndex: number
	offset: number
}
const reads = new WeakMap<JazzArchiveReaderInput, PrivateRead>()
function data(input: JazzArchiveReaderInput) {
	const value = reads.get(input)
	if (!value || input.signal.aborted) throw backupFailure('sourceChanged')
	return value
}
export function beginFinanceRead(input: JazzArchiveReaderInput) {
	reads.set(input, {
		rows: new Map(),
		parts: new Map(),
		attachments: [],
		bytes: undefined,
		fileIndex: 0,
		partIndex: 0,
		offset: 0
	})
}
export function clearFinanceRead(input: JazzArchiveReaderInput) {
	reads.get(input)?.bytes?.fill(0)
	reads.delete(input)
}
function retain<Row extends { id: string }>(
	input: JazzArchiveReaderInput,
	type: RowType,
	query: QueryBuilder<Row> & { limit(count: number): QueryBuilder<Row> }
) {
	return input.all(query.limit(input.limits.records + 1)).then((values) => {
		const current = data(input)
		if (
			values.length > input.limits.records ||
			[...current.rows.values()].reduce((sum, rows) => sum + rows.length, 0) + values.length >
				input.limits.records
		)
			return invalid()
		current.rows.set(
			type,
			values.map((value) => {
				const created = author.parse('$createdBy' in value ? value.$createdBy : undefined),
					updated = author.parse('$updatedBy' in value ? value.$updatedBy : undefined)
				return rows[type].parse({
					...value,
					sourceCreatedAt: '$createdAt' in value ? value.$createdAt : null,
					sourceUpdatedAt: '$updatedAt' in value ? value.$updatedAt : null,
					sourceCreatedBy: created.account,
					sourceUpdatedBy: updated.account,
					sourceCreatedIssuer: created.identity.issuer,
					sourceCreatedSubject: created.identity.subject,
					sourceUpdatedIssuer: updated.identity.issuer,
					sourceUpdatedSubject: updated.identity.subject
				})
			})
		)
	})
}
export function readFinanceAuthority(input: JazzArchiveReaderInput) {
	const organizationId = input.binding.workspaceId
	return Promise.all([
		retain(
			input,
			'organizations',
			app.organizations.where({ id: organizationId }).select('*', ...auditColumns)
		),
		retain(
			input,
			'organizationMembers',
			app.organizationMembers.where({ organizationId }).select('*', ...auditColumns)
		)
	]).then(() => {})
}
export function financeOwner(input: JazzArchiveReaderInput): boolean {
	const current = data(input),
		root = current.rows.get('organizations'),
		members = current.rows.get('organizationMembers')
	return (
		root?.length === 1 &&
		root[0]?.ownerId === input.binding.identityId &&
		members?.filter((row) => row.userId === input.binding.identityId).length === 1 &&
		members.some((row) => row.userId === input.binding.identityId && row.role === 'owner')
	)
}
export function readFinanceMetadata(input: JazzArchiveReaderInput) {
	const organizationId = input.binding.workspaceId
	return Promise.all([
		retain(input, 'accounts', app.accounts.where({ organizationId }).select('*', ...auditColumns)),
		retain(
			input,
			'accountMemberships',
			app.accountMemberships.where({ organizationId }).select('*', ...auditColumns)
		),
		retain(
			input,
			'categories',
			app.categories.where({ organizationId }).select('*', ...auditColumns)
		),
		retain(input, 'tags', app.tags.where({ organizationId }).select('*', ...auditColumns)),
		retain(
			input,
			'transactions',
			app.transactions.where({ organizationId }).select('*', ...auditColumns)
		),
		retain(
			input,
			'transactionTags',
			app.transactionTags.where({ organizationId }).select('*', ...auditColumns)
		),
		retain(input, 'checks', app.checks.where({ organizationId }).select('*', ...auditColumns)),
		retain(
			input,
			'internalTransfers',
			app.internalTransfers.where({ organizationId }).select('*', ...auditColumns)
		),
		retain(
			input,
			'transactionBatches',
			app.transactionBatches.where({ organizationId }).select('*', ...auditColumns)
		),
		retain(
			input,
			'batchTemplates',
			app.batchTemplates.where({ organizationId }).select('*', ...auditColumns)
		),
		retain(
			input,
			'simplefinConnections',
			app.simplefinConnections
				.where({ organizationId })
				.select(
					'id',
					'organizationId',
					'ownerId',
					'status',
					'claimedAt',
					'lastSyncAt',
					'lastOutcome',
					'importedCount',
					'existingCount',
					'omittedCount',
					...auditColumns
				)
		),
		retain(
			input,
			'simplefinAccountLinks',
			app.simplefinAccountLinks.where({ organizationId }).select('*', ...auditColumns)
		),
		retain(
			input,
			'simplefinSyncAttempts',
			app.simplefinSyncAttempts.where({ organizationId }).select('*', ...auditColumns)
		),
		retain(
			input,
			'simplefinSyncAccountResults',
			app.simplefinSyncAccountResults.where({ organizationId }).select('*', ...auditColumns)
		)
	]).then(() => {})
}
export function readFinanceRelations(input: JazzArchiveReaderInput) {
	const current = data(input),
		transactionIds = (current.rows.get('transactions') ?? []).map((row) => row.id),
		profileIds = (current.rows.get('organizationMembers') ?? []).flatMap((row) =>
			typeof row.profileId === 'string' ? [row.profileId] : []
		)
	return Promise.all([
		transactionIds.length
			? retain(
					input,
					'transactionAttachments',
					app.transactionAttachments
						.where({ transactionId: { in: transactionIds } })
						.select('*', ...auditColumns)
				)
			: Promise.resolve(current.rows.set('transactionAttachments', [])),
		profileIds.length
			? retain(
					input,
					'profiles',
					app.profiles
						.where({ id: { in: profileIds } })
						.select('id', 'userId', 'displayName', ...auditColumns)
				)
			: Promise.resolve(current.rows.set('profiles', []))
	]).then(() => {})
}
export function readFinanceFiles(input: JazzArchiveReaderInput) {
	const ids = (data(input).rows.get('transactionAttachments') ?? []).map((row) =>
		z.string().parse(row.fileId)
	)
	return ids.length
		? retain(input, 'files', app.files.where({ id: { in: ids } }).select('*', ...auditColumns))
		: Promise.resolve(data(input).rows.set('files', [])).then(() => {})
}
export function readFinanceParts(input: JazzArchiveReaderInput) {
	const ids = (data(input).rows.get('files') ?? []).map((row) => row.id)
	if (!ids.length) return Promise.resolve()
	return input
		.all(
			app.fileParts
				.where({ fileId: { in: ids } })
				.select('id', 'fileId', 'partIndex', 'sizeBytes')
				.limit(input.limits.records + 1)
		)
		.then((parts) => {
			if (parts.length > input.limits.records) return invalid()
			const groups = data(input).parts
			for (const part of parts) {
				const list = groups.get(part.fileId) ?? []
				list.push(part)
				groups.set(part.fileId, list)
			}
			for (const list of groups.values()) list.sort((a, b) => a.partIndex - b.partIndex)
		})
}
/** Checks declarations before allocating any file body. */
export function prepareFinanceFiles(input: JazzArchiveReaderInput) {
	const current = data(input),
		files = current.rows.get('files') ?? []
	const identities = new Map<string, Set<string>>(
		[...current.rows].map(([type, values]) => [type, new Set(values.map((value) => value.id))])
	)
	for (const [type, values] of current.rows)
		for (const value of values) {
			if (
				type !== 'organizations' &&
				value.organizationId != null &&
				value.organizationId !== input.binding.workspaceId
			)
				return invalid()
			for (const [name, target] of Object.entries(targets))
				if (
					value[name] != null &&
					(typeof value[name] !== 'string' || !identities.get(target)?.has(value[name]))
				)
					return invalid()
		}
	if (
		files.length > input.limits.attachments ||
		files.reduce((sum, file) => sum + integer.parse(file.sizeBytes), 0) >
			input.limits.totalAttachmentBytes
	)
		return invalid()
	for (const file of files) {
		const size = integer.min(1).max(input.limits.attachmentBytes).parse(file.sizeBytes)
		const parts = current.parts.get(file.id) ?? []
		if (
			!parts.length ||
			parts.some(
				(part, index) =>
					part.partIndex !== index ||
					!Number.isSafeInteger(part.sizeBytes) ||
					part.sizeBytes <= 0 ||
					part.sizeBytes > 256 * 1024
			) ||
			parts.reduce((sum, part) => sum + part.sizeBytes, 0) !== size
		)
			return invalid()
	}
}
export function hasFinanceFile(input: JazzArchiveReaderInput) {
	return data(input).fileIndex < (data(input).rows.get('files')?.length ?? 0)
}
function file(input: JazzArchiveReaderInput) {
	const current = data(input),
		file = current.rows.get('files')?.[current.fileIndex]
	if (!file) return invalid()
	return file
}
export function allocateFinanceFile(input: JazzArchiveReaderInput) {
	const current = data(input)
	current.bytes = new Uint8Array(integer.parse(file(input).sizeBytes))
	current.partIndex = 0
	current.offset = 0
}
export function hasFinancePart(input: JazzArchiveReaderInput) {
	const current = data(input)
	return current.partIndex < (current.parts.get(file(input).id)?.length ?? 0)
}
export function readFinancePart(input: JazzArchiveReaderInput) {
	const current = data(input),
		metadata = current.parts.get(file(input).id)?.[current.partIndex]
	if (!metadata) return invalid()
	return input
		.all(
			app.fileParts
				.where({ id: metadata.id, fileId: metadata.fileId })
				.select('id', 'data', 'sizeBytes', 'partIndex')
				.limit(2)
		)
		.then((parts) => {
			const row = parts[0],
				target = data(input)
			if (
				parts.length !== 1 ||
				!row ||
				row.partIndex !== metadata.partIndex ||
				row.sizeBytes !== metadata.sizeBytes ||
				!row.data ||
				row.data.byteLength !== metadata.sizeBytes ||
				!target.bytes
			)
				return invalid()
			target.bytes.set(row.data, target.offset)
			target.offset += metadata.sizeBytes
			target.partIndex += 1
		})
}
/** Pure encoding through APIs available in Node 24 and browsers. Bound spread arguments per chunk. */
export function encodeAttachmentBytes(bytes: Uint8Array): string {
	const chunks: string[] = []
	for (let offset = 0; offset < bytes.length; offset += 0x8000)
		chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)))
	return btoa(chunks.join(''))
}
export function hashFinanceFile(input: JazzArchiveReaderInput) {
	const current = data(input),
		metadata = file(input),
		bytes = current.bytes
	if (!bytes || current.offset !== bytes.length) return invalid()
	return input.sha256(bytes).then((sha256) => {
		const target = data(input)
		target.attachments.push({
			id: metadata.id,
			fileName: z.string().parse(metadata.fileName),
			mediaType: z.string().parse(metadata.mimeType),
			sizeBytes: bytes.length,
			sha256,
			data: encodeAttachmentBytes(bytes)
		})
		bytes.fill(0)
		target.bytes = undefined
		target.fileIndex += 1
	})
}
export function depositFinanceBackup(input: JazzArchiveReaderInput) {
	const current = data(input),
		records: ArchiveRecord[] = [],
		references: ArchiveRecord[] = []
	for (const [type, values] of current.rows)
		for (const value of values) (inert.has(type) ? references : records).push(project(type, value))
	const payload: ArchivePayload = {
		archiveId: crypto.randomUUID(),
		profile: { id: financeBackupProfile.id, version: 1 },
		source: { applicationId: input.binding.applicationId, workspaceId: input.binding.workspaceId },
		capturedAt: new Date().toISOString(),
		coverage: {
			mode: 'complete-supported-graph',
			recordTypes: Object.keys(rows),
			history: 'current-data',
			deletedRecords: 'excluded',
			consistency: 'jazz-exclusive-transaction'
		},
		records,
		references,
		attachments: current.attachments
	}
	input.accept(payload)
}
