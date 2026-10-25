import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import ExpenseOverview from './ExpenseOverview.svelte'
import CategoryLegend from './CategoryLegend.svelte'
import type { TransactionRow } from '#lib/schema.js'

function row(
	id: string,
	bookedOn: string,
	amountMinor: number,
	categoryId = 'food',
	currency = 'USD'
): TransactionRow {
	return {
		id,
		bookedOn,
		amountMinor,
		categoryId,
		currency,
		organizationId: 'org',
		accountId: 'account',
		kind: 'expense',
		source: 'manual',
		description: id,
		memo: null,
		paymentMethod: null,
		checkId: null,
		checkDetailsId: null,
		internalTransferId: null,
		externalId: null,
		batchId: null
	}
}
function overview(transactions: TransactionRow[]) {
	return render(ExpenseOverview, {
		props: {
			transactions,
			categoryNames: new Map([
				['food', 'Food'],
				['travel', 'Travel']
			]),
			tagNamesByTransaction: new Map()
		}
	}).body
}
beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(new Date(2026, 9, 23, 12))
})
afterEach(() => vi.useRealTimers())

describe('expense overview presentation', () => {
	it('defaults to 30 inclusive calendar days and excludes dates outside either boundary', () => {
		const html = overview([
			row('included-start', '2026-09-24', 10),
			row('included-end', '2026-10-23', 20),
			row('excluded-old', '2026-09-23', 100),
			row('excluded-future', '2026-10-24', 100)
		])
		expect(html).toContain('2026-09-24')
		expect(html).toContain('included-start')
		expect(html).toContain('included-end')
		expect(html).not.toContain('excluded-old')
		expect(html).not.toContain('excluded-future')
		expect(html).toContain('$0.30')
	})
	it('aggregates integer category totals, includes zero entries and keeps currencies separate', () => {
		const html = overview([
			row('meal-one', '2026-10-23', 10),
			row('meal-two', '2026-10-23', 20),
			row('zero-entry', '2026-10-23', 0, 'travel'),
			row('euro-entry', '2026-10-23', 500, 'food', 'EUR')
		])
		expect(html).toContain('$0.30')
		expect(html).toContain('zero-entry')
		expect(html).not.toContain('euro-entry')
		expect(html).toContain('EUR')
		expect(html).not.toContain('$5.30')
	})
	it('handles empty periods and unavailable historical category names', () => {
		expect(overview([])).toContain('No Expenses in this time period.')
		expect(overview([row('historical', '2026-10-23', 100, 'removed')])).toContain(
			'Category unavailable'
		)
	})
	it('provides keyboard selection controls with the selected category exposed', () => {
		const html = render(CategoryLegend, {
			props: {
				items: [{ key: 'food', label: 'Food', value: 1234, color: 'red' }],
				selectedKey: 'food',
				currency: 'USD',
				allLabel: 'All Categories',
				onselect: () => {},
				onclear: () => {}
			}
		}).body
		expect(html).toMatch(/aria-pressed="true"/)
		expect(html).toContain('$12.34')
		expect(html).toContain('All Categories')
	})
})
