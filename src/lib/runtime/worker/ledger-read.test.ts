import { expect, it } from 'vitest'
import type { TransactionRow } from '../../schema.js'
import { projectLedger, projectLedgerTags } from './ledger-read.js'

function row(id: string, bookedOn: string, amountMinor: number, currency = 'USD'): TransactionRow {
	return {
		id,
		bookedOn,
		amountMinor,
		currency,
		organizationId: 'workspace',
		accountId: 'account',
		categoryId: 'category',
		kind: 'expense',
		source: 'manual',
		description: null,
		memo: null,
		paymentMethod: null,
		checkId: null,
		checkDetailsId: null,
		internalTransferId: null,
		externalId: null,
		batchId: null
	}
}

const filters = { start: '', end: '', categoryId: '', currency: '', query: '' }
function project(
	transactions: readonly TransactionRow[],
	patch: Partial<Parameters<typeof projectLedger>[0]> = {}
) {
	return projectLedger({
		transactions,
		kind: 'expense',
		selectedAccountIds: null,
		filters,
		categoryNames: new Map(),
		tagNames: new Map(),
		requestedPage: 1,
		...patch
	})
}
it('bounds rows while preserving exact full-day totals beyond safe integer aggregation', () => {
	const rows = Array.from({ length: 61 }, (_, i) =>
		row(String(i), '2026-01-01', Number.MAX_SAFE_INTEGER)
	)
	const view = project(rows, { requestedPage: 2 })
	expect(view.groups.flatMap((group) => group.rows)).toHaveLength(25)
	expect(view.groups[0]?.rows[0]?.id).toBe('25')
	expect(view.groups[0]?.totals).toEqual([
		{ currency: 'USD', amountMinor: BigInt(Number.MAX_SAFE_INTEGER) * 61n }
	])
	expect(view).toMatchObject({ page: 2, pageCount: 3, total: 61 })
})
it('filters account selection, kind, category and tag search before pagination and totals', () => {
	const rows = [
		row('one', '2026-01-01', 100),
		{ ...row('two', '2026-01-01', 200), accountId: 'other' },
		{ ...row('income', '2026-01-01', 300), kind: 'income' } satisfies TransactionRow
	]
	const result = project(rows, {
		selectedAccountIds: new Set(['account']),
		filters: { ...filters, query: 'travel receipt' },
		tagNames: new Map([['one', ['Travel receipt']]])
	})
	expect(result.total).toBe(1)
	expect(result.groups[0]?.totals[0]?.amountMinor).toBe(100n)
	expect(project(rows, { selectedAccountIds: new Set() }).total).toBe(0)
})
it('clamps malformed and obsolete pages and rejects reversed ranges', () => {
	const rows = [row('one', '2026-01-01', 100)]
	for (const requestedPage of [NaN, Infinity, -1, 1.5, 999])
		expect(project(rows, { requestedPage }).page).toBe(1)
	expect(
		project(rows, { filters: { ...filters, start: '2026-02-01', end: '2026-01-01' } })
	).toMatchObject({ validRange: false, total: 0, groups: [] })
})
it('sorts days and preserves per-day row order across page boundaries', () => {
	const rows = Array.from({ length: 26 }, (_, i) => row(String(i), '2026-01-02', i))
	rows.unshift(row('older', '2026-01-01', 20))
	const view = project(rows, { requestedPage: 2 })
	expect(view.groups.map((group) => group.bookedOn)).toEqual(['2026-01-02', '2026-01-01'])
	expect(view.groups.flatMap((group) => group.rows.map((row) => row.id))).toEqual(['25', 'older'])
})
it('keeps all tag names reachable through bounded pages', () => {
	const names = Array.from({ length: 251 }, (_, i) => `Tag ${i}`)
	expect(projectLedgerTags(names, 100)).toMatchObject({ offset: 100, total: 251, hasMore: true })
	expect(projectLedgerTags(names, 100).names).toHaveLength(100)
	expect(projectLedgerTags(names, 999).names.at(-1)).toBe('Tag 250')
})
