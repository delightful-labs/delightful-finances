import { z } from 'zod'
import { appAccountSchema } from './accounts.js'
import { appCategorySchema } from './categories.js'
import { appTagSchema } from './tags.js'
import { appCheckDetailsSchema, appTransactionSchema, currencyText } from './transactions.js'

export const mergeSnapshotLimits = { records: 10_000, bytes: 8 * 1024 * 1024 }
const id = z.uuid()
const text = z.string().refine((value) => value.trim().length > 0)
const row = { id, organizationId: id }
const archivedAt = z.iso.datetime({ offset: true }).nullable()
const rows = <T extends z.ZodRawShape>(shape: T) =>
	z.array(z.strictObject({ ...row, ...shape })).max(mergeSnapshotLimits.records)
// Run canonical validation without applying its form-oriented text transforms.
const preserve = <T extends z.ZodType>(schema: T) =>
	z.custom<z.input<T>>((value) => schema.safeParse(value).success)
const [expense, manualIncome, checkIncome] = appTransactionSchema.options

// No form transforms/defaults: validation must not rewrite captured finance values.
const snapshotShape = z.strictObject({
	version: z.literal(1),
	sourceIdentityId: id,
	sourceOrganization: z.strictObject({
		id,
		ownerId: id,
		kind: z.literal('personal'),
		name: text,
		defaultCurrency: currencyText
	}),
	accounts: rows({
		...appAccountSchema.shape,
		name: preserve(appAccountSchema.shape.name),
		currency: appAccountSchema.shape.currency.unwrap(),
		archivedAt
	}),
	categories: rows({
		...appCategorySchema.shape,
		name: preserve(appCategorySchema.shape.name),
		isSystem: appCategorySchema.shape.isSystem.unwrap(),
		archivedAt
	}),
	tags: rows({
		...appTagSchema.shape,
		name: preserve(appTagSchema.shape.name),
		categoryId: appTagSchema.shape.categoryId.unwrap(),
		archivedAt
	}),
	transactions: rows({
		...expense.shape.money.shape,
		kind: z.union([expense.shape.kind, manualIncome.shape.kind]),
		accountId: id,
		categoryId: id,
		bookedOn: expense.shape.bookedOn,
		memo: preserve(expense.shape.memo.unwrap()).nullable(),
		paymentMethod: z
			.union([manualIncome.shape.paymentMethod.unwrap(), checkIncome.shape.paymentMethod])
			.nullable(),
		checkDetailsId: id.nullable(),
		source: z.union(expense.shape.source.options.map((option) => option.shape.source)),
		externalId: preserve(expense.shape.source.options[1].shape.externalId).nullable(),
		batchId: id.nullable()
	}),
	checkDetails: rows({
		transactionId: id,
		accountId: id,
		...appCheckDetailsSchema.shape,
		checkNumber: preserve(appCheckDetailsSchema.shape.checkNumber),
		payerName: appCheckDetailsSchema.shape.payerName.unwrap().nullable(),
		bankName: appCheckDetailsSchema.shape.bankName.unwrap().nullable(),
		memoOnCheck: appCheckDetailsSchema.shape.memoOnCheck.unwrap().nullable()
	}),
	transactionTags: rows({ transactionId: id, tagId: id }),
	transactionBatches: rows({ name: z.string().nullable() }),
	batchTemplates: rows({ name: text }),
	bankAccountLinks: rows({
		accountId: id,
		simplefinAccountId: text,
		simplefinOrgId: z.string().nullable()
	}),
	// Capture must explicitly supply this scope; nonempty arrays are unsupported.
	transactionAttachments: z
		.array(z.strictObject({ id, transactionId: id, fileId: id }))
		.max(mergeSnapshotLimits.records),
	excludedConnectionCount: z.number().int().nonnegative().max(mergeSnapshotLimits.records)
})

export const accountMergeSnapshotSchema = snapshotShape.superRefine((snapshot, context) => {
	const issue = (path: (string | number)[], message: string) =>
		context.addIssue({ code: 'custom', path, message })
	const organizationId = snapshot.sourceOrganization.id
	if (snapshot.sourceOrganization.ownerId !== snapshot.sourceIdentityId) {
		issue(['sourceOrganization', 'ownerId'], 'source-not-owned')
	}
	// Every collection uses the same scope, uniqueness and indexing rules.
	let count = snapshot.transactionAttachments.length
	function index<T extends { id: string; organizationId: string }>(
		table: string,
		records: readonly T[]
	) {
		count += records.length
		const result = new Map<string, T>()
		for (const [position, record] of records.entries()) {
			if (result.has(record.id)) issue([table, position, 'id'], 'duplicate-record')
			if (record.organizationId !== organizationId)
				issue([table, position, 'organizationId'], 'cross-organization-record')
			result.set(record.id, record)
		}
		return result
	}
	const accounts = index('accounts', snapshot.accounts)
	const categories = index('categories', snapshot.categories)
	const tags = index('tags', snapshot.tags)
	const transactions = index('transactions', snapshot.transactions)
	const checks = index('checkDetails', snapshot.checkDetails)
	const batches = index('transactionBatches', snapshot.transactionBatches)
	index('batchTemplates', snapshot.batchTemplates)
	index('transactionTags', snapshot.transactionTags)
	index('bankAccountLinks', snapshot.bankAccountLinks)
	if (count > mergeSnapshotLimits.records) issue([], 'record-limit')
	if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > mergeSnapshotLimits.bytes)
		issue([], 'byte-limit')
	if (snapshot.transactionAttachments.length > 0)
		issue(['transactionAttachments'], 'unsupported-attachments')
	function references<T>(
		table: string,
		records: readonly T[],
		field: keyof T & string,
		target: ReadonlyMap<string, unknown>,
		message: string
	) {
		for (const [position, record] of records.entries()) {
			const value = record[field]
			if (value !== null && (typeof value !== 'string' || !target.has(value)))
				issue([table, position, field], message)
		}
	}
	references('tags', snapshot.tags, 'categoryId', categories, 'missing-category')
	references('transactions', snapshot.transactions, 'batchId', batches, 'missing-batch')
	references(
		'transactionTags',
		snapshot.transactionTags,
		'transactionId',
		transactions,
		'invalid-tag-reference'
	)
	references('transactionTags', snapshot.transactionTags, 'tagId', tags, 'invalid-tag-reference')
	references(
		'bankAccountLinks',
		snapshot.bankAccountLinks,
		'accountId',
		accounts,
		'missing-account'
	)
	for (const [index, transaction] of snapshot.transactions.entries()) {
		const path = ['transactions', index]
		const account = accounts.get(transaction.accountId)
		const category = categories.get(transaction.categoryId)
		if (!account || account.currency !== transaction.currency)
			issue([...path, 'accountId'], 'invalid-account-reference')
		if (!category || category.kind !== transaction.kind)
			issue([...path, 'categoryId'], 'invalid-category-reference')
		if ((transaction.source === 'simplefin') !== (transaction.externalId !== null))
			issue([...path, 'externalId'], 'invalid-provider-identity')
		const needsCheck = transaction.paymentMethod === 'check'
		if (needsCheck && (transaction.kind !== 'income' || transaction.source !== 'manual'))
			issue([...path, 'paymentMethod'], 'invalid-check-transaction')
		if (
			transaction.kind === 'income' &&
			transaction.source === 'manual' &&
			transaction.paymentMethod === null
		)
			issue([...path, 'paymentMethod'], 'missing-payment-method')
		const check =
			transaction.checkDetailsId === null ? undefined : checks.get(transaction.checkDetailsId)
		if (
			needsCheck
				? !check ||
					check.transactionId !== transaction.id ||
					check.accountId !== transaction.accountId
				: transaction.checkDetailsId !== null
		)
			issue([...path, 'checkDetailsId'], 'invalid-check-reference')
	}
	for (const [index, check] of snapshot.checkDetails.entries()) {
		const transaction = transactions.get(check.transactionId)
		if (
			!transaction ||
			transaction.checkDetailsId !== check.id ||
			transaction.accountId !== check.accountId ||
			transaction.paymentMethod !== 'check'
		)
			issue(['checkDetails', index], 'orphan-check-details')
	}
	const pairs = new Set<string>()
	for (const [index, link] of snapshot.transactionTags.entries()) {
		const pair = `${link.transactionId}:${link.tagId}`
		if (pairs.has(pair)) issue(['transactionTags', index], 'duplicate-tag-link')
		pairs.add(pair)
	}
})
