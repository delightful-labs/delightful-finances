import { expect, it } from 'vitest'
import type { TransactionRow } from '../../schema.js'
import { projectOverview } from './overview-read.js'
import {
	emptyOverviewView,
	overviewViewSchema,
	overviewCommandSchema
} from './overview-protocol.js'
import { emptyLedgerView } from './ledger-protocol.js'

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

function id(index: number) {
	return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}
function project(
	transactions: readonly TransactionRow[],
	patch: Partial<Parameters<typeof projectOverview>[0]> = {}
) {
	return projectOverview({
		transactions,
		links: [],
		selectedAccountIds: null,
		categoryNames: new Map(),
		tagNames: new Map(),
		filters: {
			start: '2026-01-01',
			end: '2026-01-31',
			categoryId: null,
			currency: 'USD',
			query: ''
		},
		categoryOffset: 0,
		requestedPage: 1,
		...patch
	})
}
it('suppresses pending, conflicted and marked transfers before account or expense selection', () => {
	const transactions = [
		row('pending', '2026-01-01', 100),
		{
			...row('income', '2026-01-01', 100),
			kind: 'income',
			accountId: 'other'
		} satisfies TransactionRow,
		row('conflict', '2026-01-01', 200),
		{ ...row('marked', '2026-01-01', 300), internalTransferId: 'unknown' },
		row('ordinary', '2026-01-01', 7)
	]
	const result = project(transactions, {
		selectedAccountIds: new Set(['account']),
		links: [
			{ id: 'pending-link', expenseTransactionId: 'pending', incomeTransactionId: 'income' },
			{
				id: 'missing-endpoint',
				expenseTransactionId: 'conflict',
				incomeTransactionId: 'unreadable'
			}
		]
	})
	expect(result.total).toBe(7n)
	expect(result.transactionCount).toBe(1)
	expect(result.ledger.groups[0]?.rows.map((row) => row.id)).toEqual(['ordinary'])
})
it('aggregates exactly and falls back to the first available period currency', () => {
	const rows = [
		row('one', '2026-01-01', Number.MAX_SAFE_INTEGER, 'EUR'),
		row('two', '2026-01-01', Number.MAX_SAFE_INTEGER, 'EUR')
	]
	const result = project(rows)
	expect(result.currency).toBe('EUR')
	expect(result.total).toBe(BigInt(Number.MAX_SAFE_INTEGER) * 2n)
	expect(result.slices[0]?.value).toBe(result.total)
	expect(result.chart.at(-1)?.endAngle).toBe(Math.PI * 2)
})
it('keeps every category reachable and the entire total represented in bounded chart pages', () => {
	const rows = Array.from({ length: 1005 }, (_, index) => ({
		...row(id(index + 1), '2026-01-01', 1),
		categoryId: id(index + 2000)
	}))
	const seen = new Set<string>()
	for (const categoryOffset of [0, 500, 1000]) {
		const result = project(rows, { categoryOffset })
		expect(result.chart.length).toBeLessThanOrEqual(502)
		expect(result.slices.length).toBeLessThanOrEqual(500)
		expect(result.total).toBe(1005n)
		expect(result.chart.reduce((sum, arc) => sum + arc.value, 0)).toBeCloseTo(1, 8)
		expect(result.chart[0]?.startAngle).toBe(0)
		expect(result.chart.at(-1)?.endAngle).toBe(Math.PI * 2)
		for (const category of result.categories) seen.add(category.id)
	}
	expect(seen.size).toBe(1005)
	expect(project(rows).chart.at(-1)).toMatchObject({ categoryId: null, pageOffset: 500 })
	expect(project(rows, { categoryOffset: 1000 }).chart[0]).toMatchObject({
		categoryId: null,
		pageOffset: 500
	})
})
it('searches tag labels and dates before totals, and ignores a category absent from the period', () => {
	const rows = [
		row('match', '2026-01-02', 15),
		row('outside', '2025-12-31', 40),
		row('other', '2026-01-03', 100)
	]
	const result = project(rows, {
		tagNames: new Map([
			['match', ['Receipt travel']],
			['outside', ['Receipt travel']]
		]),
		filters: {
			start: '2026-01-01',
			end: '2026-01-31',
			categoryId: 'missing',
			currency: 'USD',
			query: 'receipt travel'
		}
	})
	expect(result.total).toBe(15n)
	expect(result.activeCategory).toBeNull()
	expect(project(rows, { selectedAccountIds: new Set() }).total).toBe(0n)
})
it('bounds the report ledger while preserving its complete totals and category selection', () => {
	const rows = Array.from({ length: 31 }, (_, index) => row(String(index), '2026-01-01', 10))
	const result = project(rows, { requestedPage: 2 })
	expect(result.total).toBe(310n)
	expect(result.ledger.total).toBe(31)
	expect(result.ledger.groups[0]?.rows).toHaveLength(6)
	expect(result.ledger.groups[0]?.totals[0]?.amountMinor).toBe(310n)
	expect(
		project(rows, {
			filters: {
				start: '2026-02-01',
				end: '2026-01-01',
				categoryId: null,
				currency: 'USD',
				query: ''
			}
		})
	).toMatchObject({ validRange: false, total: 0n })
})
it('validates only bounded public presentation, rejecting private handles and malformed commands', () => {
	const result = project([{ ...row(id(1), '2026-01-01', 20), categoryId: id(2) }])
	const view = {
		...emptyOverviewView(),
		...result,
		active: true,
		ledger: {
			...emptyLedgerView(),
			...result.ledger,
			slots: [],
			groups: result.ledger.groups.map((group) => ({
				...group,
				rows: group.rows.map((row) => ({ ...row, href: `/expenses/${row.id}` }))
			}))
		}
	}
	expect(overviewViewSchema.safeParse(view).success).toBe(true)
	expect(overviewViewSchema.safeParse({ ...view, db: {} }).success).toBe(false)
	expect(overviewCommandSchema.safeParse({ type: 'CATEGORY_PAGE', offset: -1 }).success).toBe(false)
	expect(overviewCommandSchema.safeParse({ type: 'PRESET', days: 365 }).success).toBe(false)
})
