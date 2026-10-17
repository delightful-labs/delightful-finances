import { describe, expect, it } from 'vitest'
import type { AccountMergeSnapshot } from '../schema/account-merge.js'
import { accountMergeSnapshotSchema, mergeSnapshotLimits } from './account-merge.js'

const id = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`
const scope = { organizationId: id(2) }
const archivedAt = '2026-10-10T12:34:56.789Z'

function fixture(): AccountMergeSnapshot {
	return {
		version: 1,
		sourceIdentityId: id(1),
		sourceOrganization: {
			id: id(2),
			ownerId: id(1),
			kind: 'personal',
			name: 'Personal',
			defaultCurrency: 'USD'
		},
		accounts: [
			{ ...scope, id: id(3), name: ' Checking ', kind: 'bank', currency: 'USD', archivedAt }
		],
		categories: [
			{ ...scope, id: id(4), name: ' Income ', kind: 'income', isSystem: false, archivedAt }
		],
		tags: [{ ...scope, id: id(5), name: ' Work ', categoryId: id(4), archivedAt }],
		transactions: [
			{
				...scope,
				id: id(6),
				accountId: id(3),
				categoryId: id(4),
				amountMinor: 12345,
				currency: 'USD',
				kind: 'income',
				bookedOn: '2026-10-09',
				memo: ' Original memo ',
				paymentMethod: 'check',
				checkDetailsId: id(7),
				source: 'manual',
				externalId: null,
				batchId: id(8)
			}
		],
		checkDetails: [
			{
				...scope,
				id: id(7),
				transactionId: id(6),
				accountId: id(3),
				checkNumber: ' 00123 ',
				checkDate: '2026-10-08',
				payerName: ' Payer ',
				bankName: null,
				memoOnCheck: ''
			}
		],
		transactionTags: [{ ...scope, id: id(9), transactionId: id(6), tagId: id(5) }],
		transactionBatches: [{ ...scope, id: id(8), name: null }],
		batchTemplates: [{ ...scope, id: id(10), name: 'Template' }],
		bankAccountLinks: [
			{
				...scope,
				id: id(11),
				accountId: id(3),
				simplefinAccountId: 'provider-account',
				simplefinOrgId: 'provider-org'
			}
		],
		transactionAttachments: [],
		excludedConnectionCount: 1
	}
}

function expectIssue(input: unknown, message: string, path: (string | number)[]) {
	const result = accountMergeSnapshotSchema.safeParse(input)
	expect(result.success).toBe(false)
	if (result.success) return
	expect(result.error.issues).toContainEqual(expect.objectContaining({ message, path }))
}

describe('merge snapshot preservation', () => {
	it('round-trips an archived check graph without trimming, defaulting or losing relationships', () => {
		const input = fixture()
		const original = structuredClone(input)
		expect(accountMergeSnapshotSchema.parse(JSON.parse(JSON.stringify(input)))).toEqual(original)
		expect(input).toEqual(original)
	})
	it('preserves distinct same-looking manual transactions and their nullable fields', () => {
		const input = fixture()
		input.transactions = input.transactions
			.flatMap((record) => [record, { ...record, id: id(12) }])
			.map((record) => ({
				...record,
				paymentMethod: 'cash',
				checkDetailsId: null,
				memo: ' ',
				batchId: null
			}))
		input.checkDetails = []
		expect(accountMergeSnapshotSchema.parse(input)).toEqual(input)
	})
	it.each(['expense', 'income'] satisfies AccountMergeSnapshot['transactions'][number]['kind'][])(
		'preserves imported %s provenance without inventing a payment method',
		(kind) => {
			const input = fixture()
			input.categories = input.categories.map((record) => ({ ...record, kind }))
			input.transactions = input.transactions.map((record) => ({
				...record,
				kind,
				source: 'simplefin',
				externalId: ' external-identity ',
				paymentMethod: null,
				checkDetailsId: null
			}))
			input.checkDetails = []
			expect(accountMergeSnapshotSchema.parse(input)).toEqual(input)
		}
	)
	it.each(['currency', 'archivedAt'])(
		'requires explicit account %s instead of supplying a default',
		(field) => {
			const input = fixture()
			const accounts = input.accounts.map((record) => {
				const values: Record<string, unknown> = { ...record }
				delete values[field]
				return values
			})
			expect(accountMergeSnapshotSchema.safeParse({ ...input, accounts }).success).toBe(false)
		}
	)
	it.each(['isSystem', 'categoryId', 'paymentMethod', 'transactionAttachments'])(
		'requires explicit %s rather than treating missing data as empty/defaulted',
		(field) => {
			const input = fixture()
			const omit = (record: object) => {
				const values: Record<string, unknown> = { ...record }
				delete values[field]
				return values
			}
			expect(
				accountMergeSnapshotSchema.safeParse({
					...omit(input),
					categories: input.categories.map(omit),
					tags: input.tags.map(omit),
					transactions: input.transactions.map(omit)
				}).success
			).toBe(false)
		}
	)
})

describe('merge snapshot graph integrity', () => {
	it('requires an owned personal workspace', () => {
		const input = fixture()
		expectIssue({ ...input, sourceIdentityId: id(99) }, 'source-not-owned', [
			'sourceOrganization',
			'ownerId'
		])
		expect(
			accountMergeSnapshotSchema.safeParse({
				...input,
				sourceOrganization: { ...input.sourceOrganization, kind: 'business' }
			}).success
		).toBe(false)
	})
	it.each([
		'accounts',
		'categories',
		'tags',
		'transactions',
		'checkDetails',
		'transactionTags',
		'transactionBatches',
		'batchTemplates',
		'bankAccountLinks'
	] satisfies (keyof AccountMergeSnapshot)[])(
		'rejects foreign scope and duplicate IDs in %s',
		(table) => {
			const input = fixture()
			const records = input[table]
			if (!Array.isArray(records)) throw new Error('Expected a record collection')
			expectIssue(
				{ ...input, [table]: records.map((record) => ({ ...record, organizationId: id(99) })) },
				'cross-organization-record',
				[table, 0, 'organizationId']
			)
			expectIssue({ ...input, [table]: [...records, ...records] }, 'duplicate-record', [
				table,
				1,
				'id'
			])
		}
	)
	it.each([
		{ values: { accountId: id(99) }, message: 'invalid-account-reference', field: 'accountId' },
		{ values: { currency: 'EUR' }, message: 'invalid-account-reference', field: 'accountId' },
		{ values: { categoryId: id(99) }, message: 'invalid-category-reference', field: 'categoryId' },
		{ values: { kind: 'expense' }, message: 'invalid-category-reference', field: 'categoryId' },
		{ values: { batchId: id(99) }, message: 'missing-batch', field: 'batchId' },
		{
			values: { externalId: 'unexpected' },
			message: 'invalid-provider-identity',
			field: 'externalId'
		},
		{ values: { source: 'simplefin' }, message: 'invalid-provider-identity', field: 'externalId' },
		{ values: { paymentMethod: null }, message: 'missing-payment-method', field: 'paymentMethod' },
		{ values: { kind: 'expense' }, message: 'invalid-check-transaction', field: 'paymentMethod' },
		{
			values: { checkDetailsId: id(99) },
			message: 'invalid-check-reference',
			field: 'checkDetailsId'
		},
		{
			values: { paymentMethod: 'cash' },
			message: 'invalid-check-reference',
			field: 'checkDetailsId'
		}
	])('rejects transaction $values with $message', ({ values, message, field }) => {
		const input = fixture()
		expectIssue(
			{ ...input, transactions: input.transactions.map((record) => ({ ...record, ...values })) },
			message,
			['transactions', 0, field]
		)
	})
	it.each([
		{ values: { transactionId: id(99) } },
		{ values: { accountId: id(99) } },
		{ values: { id: id(99) } }
	])('rejects orphan or mismatched check details $values', ({ values }) => {
		const input = fixture()
		expectIssue(
			{ ...input, checkDetails: input.checkDetails.map((record) => ({ ...record, ...values })) },
			'orphan-check-details',
			['checkDetails', 0]
		)
	})
	it.each([
		{ table: 'tags', field: 'categoryId', message: 'missing-category' },
		{ table: 'transactionTags', field: 'transactionId', message: 'invalid-tag-reference' },
		{ table: 'transactionTags', field: 'tagId', message: 'invalid-tag-reference' },
		{ table: 'bankAccountLinks', field: 'accountId', message: 'missing-account' }
	] satisfies {
		table: 'tags' | 'transactionTags' | 'bankAccountLinks'
		field: string
		message: string
	}[])('rejects broken $table.$field references', ({ table, field, message }) => {
		const input = fixture()
		expectIssue(
			{ ...input, [table]: input[table].map((record) => ({ ...record, [field]: id(99) })) },
			message,
			[table, 0, field]
		)
	})
	it('rejects the same transaction/tag pair under a different link ID', () => {
		const input = fixture()
		input.transactionTags.push(
			...input.transactionTags.map((record) => ({ ...record, id: id(99) }))
		)
		expectIssue(input, 'duplicate-tag-link', ['transactionTags', 1])
	})
})

describe('merge snapshot unsupported or invalid input', () => {
	it('blocks attachments rather than dropping them', () => {
		expectIssue(
			{
				...fixture(),
				transactionAttachments: [{ id: id(20), transactionId: id(6), fileId: id(21) }]
			},
			'unsupported-attachments',
			['transactionAttachments']
		)
	})
	it.each([
		{ version: 2 },
		{ recoveryPhrase: 'must-not-persist' },
		{ simplefinConnections: [] },
		{ accounts: [{ ...fixture().accounts[0], ciphertext: 'must-not-persist' }] },
		{ bankAccountLinks: [{ ...fixture().bankAccountLinks[0], connectionId: id(99) }] }
	])('rejects unsupported versions and unexpected payload fields %j', (values) => {
		expect(accountMergeSnapshotSchema.safeParse({ ...fixture(), ...values }).success).toBe(false)
	})
	it.each([
		{ amountMinor: -1 },
		{ amountMinor: 1.5 },
		{ amountMinor: Number.MAX_SAFE_INTEGER + 1 },
		{ currency: 'ZZZ' },
		{ bookedOn: '2026-02-29' }
	])('reuses canonical transaction field validation for %j', (values) => {
		const input = fixture()
		expect(
			accountMergeSnapshotSchema.safeParse({
				...input,
				transactions: input.transactions.map((record) => ({ ...record, ...values }))
			}).success
		).toBe(false)
	})
	it('rejects blank names and check numbers without normalizing input', () => {
		const input = fixture()
		expect(
			accountMergeSnapshotSchema.safeParse({
				...input,
				accounts: input.accounts.map((record) => ({ ...record, name: ' ' }))
			}).success
		).toBe(false)
		expect(
			accountMergeSnapshotSchema.safeParse({
				...input,
				checkDetails: input.checkDetails.map((record) => ({ ...record, checkNumber: ' ' }))
			}).success
		).toBe(false)
	})
})

describe('merge snapshot limits', () => {
	it('enforces the aggregate record limit across collections without truncation', () => {
		const input = fixture()
		// Eight records outside templates; the organization is not a collection record.
		input.batchTemplates = Array.from(
			{ length: mergeSnapshotLimits.records - 8 },
			(_, position) => ({ ...scope, id: id(position + 100), name: 'Template' })
		)
		expect(accountMergeSnapshotSchema.parse(input).batchTemplates).toHaveLength(
			mergeSnapshotLimits.records - 8
		)
		input.batchTemplates.push({ ...scope, id: id(20_000), name: 'Over limit' })
		expectIssue(input, 'record-limit', [])
	})
	it('measures the JSON payload in UTF-8 bytes, including multibyte text', () => {
		const input = fixture()
		const baseline = new TextEncoder().encode(JSON.stringify(input)).byteLength
		const originalMemo = input.transactions.map((record) => record.memo).join('')
		const available = mergeSnapshotLimits.bytes - baseline + originalMemo.length
		const memo = 'a'.repeat(available)
		input.transactions = input.transactions.map((record) => ({ ...record, memo }))
		expect(accountMergeSnapshotSchema.parse(input)).toEqual(input)
		input.transactions = input.transactions.map((record) => ({
			...record,
			memo: `${memo.slice(0, -1)}é`
		}))
		expectIssue(input, 'byte-limit', [])
	})
})
