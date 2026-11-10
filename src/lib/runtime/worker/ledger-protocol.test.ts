import { expect, it } from 'vitest'
import { ledgerViewSchema, ledgerCommandSchema, emptyLedgerView } from './ledger-protocol.js'
import { projectLedger } from './ledger-read.js'
import type { TransactionRow } from '../../schema.js'

const id = '00000000-0000-4000-8000-000000000001'
const row: TransactionRow = {
	id,
	bookedOn: '2026-11-09',
	amountMinor: 123,
	currency: 'USD',
	organizationId: id,
	accountId: id,
	categoryId: id,
	kind: 'expense',
	source: 'manual',
	description: 'Receipt',
	memo: 'Private memo',
	paymentMethod: null,
	checkId: null,
	checkDetailsId: null,
	internalTransferId: null,
	externalId: null,
	batchId: null
}
function populated() {
	const ledger = projectLedger({
		transactions: [row],
		kind: 'expense',
		selectedAccountIds: null,
		filters: { start: '', end: '', categoryId: '', currency: '', query: '' },
		categoryNames: new Map(),
		tagNames: new Map([[id, Array.from({ length: 201 }, (_, i) => `Tag ${i}`)]]),
		requestedPage: 1
	})
	return {
		...emptyLedgerView(),
		...ledger,
		active: true,
		slots: [{ page: 1, href: '/expenses' }],
		groups: ledger.groups.map((group) => ({
			...group,
			rows: group.rows.map((row) => ({ ...row, href: `/expenses/${id}` }))
		}))
	}
}
it('validates bounded presentation and omits private transaction fields', () => {
	const view = ledgerViewSchema.parse(populated())
	const projected = view.groups[0]?.rows[0]
	expect(projected?.tags).toMatchObject({ total: 201, offset: 0, hasMore: true })
	expect(projected?.tags.names).toHaveLength(100)
	expect(projected).not.toHaveProperty('memo')
	expect(projected).not.toHaveProperty('accountId')
	expect(ledgerViewSchema.safeParse({ ...view, binding: {} }).success).toBe(false)
})
it('enforces the total page row bound even across separate groups', () => {
	const view = populated()
	const group = view.groups[0]
	if (!group) throw new Error('Missing fixture day')
	expect(
		ledgerViewSchema.safeParse({
			...view,
			groups: [
				{ ...group, rows: Array.from({ length: 20 }, () => group.rows[0]) },
				{ ...group, rows: Array.from({ length: 20 }, () => group.rows[0]) }
			]
		}).success
	).toBe(false)
})
it('rejects unknown commands, unsafe cursors and embedded domain handles', () => {
	expect(ledgerCommandSchema.safeParse({ type: 'TOGGLE_ACCOUNT', accountId: id }).success).toBe(
		true
	)
	for (const command of [
		{ type: 'TAG_PAGE', transactionId: id, offset: Number.MAX_SAFE_INTEGER + 1 },
		{ type: 'TAG_PAGE', transactionId: id, offset: -1 },
		{ type: 'ALL_ACCOUNTS', db: {} },
		{ type: 'SET_FILTER', query: () => {} }
	])
		expect(ledgerCommandSchema.safeParse(command).success).toBe(false)
})
