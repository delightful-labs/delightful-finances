import type { InternalTransfer, TransactionRow } from '../../schema.js'
import { resolveInternalTransferLinks } from '../../domain/internal-transfer.js'
import { filterTransactions } from '../../filters/transaction-list-filters.js'
import { projectLedger } from './ledger-read.js'

export const OVERVIEW_CATEGORY_PAGE_SIZE = 500
export type OverviewReadFilters = {
	start: string
	end: string
	categoryId: string | null
	currency: string
	query: string
}

/** Resolve transfer conflicts against complete readable history before selecting expenses or accounts. */
export function projectOverview(input: {
	transactions: readonly TransactionRow[]
	links: readonly Pick<InternalTransfer, 'id' | 'expenseTransactionId' | 'incomeTransactionId'>[]
	selectedAccountIds: ReadonlySet<string> | null
	categoryNames: ReadonlyMap<string, string>
	tagNames: ReadonlyMap<string, readonly string[]>
	filters: OverviewReadFilters
	categoryOffset: number
	requestedPage: number
	tagCursor?: { transactionId: string; offset: number } | null
}) {
	const resolution = resolveInternalTransferLinks(input.links, input.transactions)
	const unlinked = filterTransactions(
		input.transactions.filter(
			(row) =>
				row.kind === 'expense' &&
				!resolution.suppressedTransactionIds.has(row.id) &&
				(input.selectedAccountIds === null || input.selectedAccountIds.has(row.accountId))
		),
		{ start: '', end: '', categoryId: '', currency: '', query: input.filters.query },
		input.categoryNames,
		input.tagNames
	)
	const validRange = Boolean(
		input.filters.start && input.filters.end && input.filters.start <= input.filters.end
	)
	const period = validRange
		? unlinked.filter(
				(row) => row.bookedOn >= input.filters.start && row.bookedOn <= input.filters.end
			)
		: []
	const currencies = [...new Set(period.map((row) => row.currency))].sort()
	const currency = currencies.includes(input.filters.currency)
		? input.filters.currency
		: (currencies[0] ?? 'USD')
	const expenses = period.filter((row) => row.currency === currency)
	const ids = [...new Set(unlinked.map((row) => row.categoryId))].sort()
	const totals = new Map<string, bigint>()
	for (const row of expenses)
		totals.set(row.categoryId, (totals.get(row.categoryId) ?? 0n) + BigInt(row.amountMinor))
	const total = [...totals.values()].reduce((sum, value) => sum + value, 0n)
	const activeCategory =
		input.filters.categoryId !== null && totals.has(input.filters.categoryId)
			? input.filters.categoryId
			: null
	const slices = ids.map((key, index) => ({
		key,
		value: totals.get(key) ?? 0n,
		label: input.categoryNames.get(key)?.slice(0, 4096) ?? null,
		color: `oklch(72% 0.17 ${(130 + index * 137.507764) % 360})`
	}))
	const requested =
		Number.isSafeInteger(input.categoryOffset) && input.categoryOffset >= 0
			? input.categoryOffset
			: 0
	const offset = Math.min(
		Math.floor(requested / OVERVIEW_CATEGORY_PAGE_SIZE) * OVERVIEW_CATEGORY_PAGE_SIZE,
		Math.max(
			0,
			Math.floor((slices.length - 1) / OVERVIEW_CATEGORY_PAGE_SIZE) * OVERVIEW_CATEGORY_PAGE_SIZE
		)
	)
	const end = offset + OVERVIEW_CATEGORY_PAGE_SIZE
	const visible = slices.slice(offset, end)
	const before = slices.slice(0, offset).reduce((sum, row) => sum + row.value, 0n)
	const after = slices.slice(end).reduce((sum, row) => sum + row.value, 0n)
	// The two neutral continuation arcs retain the entire total, including categories
	// outside this page. Their public actions open the preceding/following category page.
	const parts = [
		...(offset > 0
			? [
					{
						key: 'previous',
						value: before,
						color: 'currentColor',
						categoryId: null,
						pageOffset: offset - OVERVIEW_CATEGORY_PAGE_SIZE
					}
				]
			: []),
		...visible.map((row) => ({
			key: row.key,
			value: row.value,
			color: row.color,
			categoryId: row.key,
			pageOffset: null
		})),
		...(end < slices.length
			? [{ key: 'next', value: after, color: 'currentColor', categoryId: null, pageOffset: end }]
			: [])
	]
	let cumulative = 0n
	const angle = (value: bigint) =>
		total > 0n
			? (Number((value * 1_000_000_000_000n) / total) / 1_000_000_000_000) * Math.PI * 2
			: 0
	const chart = parts.map((part) => {
		const startAngle = angle(cumulative)
		cumulative += part.value
		return {
			key: part.key,
			color: part.color,
			categoryId: part.categoryId,
			pageOffset: part.pageOffset,
			value: total > 0n ? Number((part.value * 1_000_000_000_000n) / total) / 1_000_000_000_000 : 0,
			startAngle,
			endAngle: angle(cumulative)
		}
	})
	const rows =
		activeCategory === null ? expenses : expenses.filter((row) => row.categoryId === activeCategory)
	return {
		validRange,
		currency,
		currencies,
		total,
		transactionCount: expenses.length,
		activeCategory,
		activeCategoryName:
			activeCategory === null
				? null
				: (input.categoryNames.get(activeCategory)?.slice(0, 4096) ?? null),
		slices: visible
			.filter((row) => totals.has(row.key))
			.sort((a, b) =>
				a.value === b.value ? a.key.localeCompare(b.key) : a.value > b.value ? -1 : 1
			),
		chart,
		categoryPage: { offset, total: slices.length, hasMore: end < slices.length },
		categories: visible.map((row) => ({ id: row.key, name: row.label })),
		ledger: projectLedger({
			transactions: rows,
			kind: 'expense',
			selectedAccountIds: null,
			categoryNames: input.categoryNames,
			tagNames: input.tagNames,
			filters: { start: '', end: '', categoryId: '', currency: '', query: '' },
			requestedPage: input.requestedPage,
			tagCursor: input.tagCursor ?? null
		})
	}
}
