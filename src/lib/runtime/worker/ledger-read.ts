import type { TransactionRow } from '../../schema.js'
import {
	filterTransactions,
	type TransactionListFilters
} from '../../filters/transaction-list-filters.js'

export const LEDGER_PAGE_SIZE = 25

/** Full readable history stays in the worker; only this page crosses the realm boundary. */
export function projectLedger(input: {
	transactions: readonly TransactionRow[]
	kind: TransactionRow['kind']
	selectedAccountIds: ReadonlySet<string> | null
	filters: TransactionListFilters
	categoryNames: ReadonlyMap<string, string>
	tagNames: ReadonlyMap<string, readonly string[]>
	requestedPage: number
	tagCursor?: { transactionId: string; offset: number } | null
}) {
	const selected = input.transactions.filter(
		(row) =>
			row.kind === input.kind &&
			(input.selectedAccountIds === null || input.selectedAccountIds.has(row.accountId))
	)
	const validRange =
		!input.filters.start || !input.filters.end || input.filters.start <= input.filters.end
	const filtered = validRange
		? filterTransactions(selected, input.filters, input.categoryNames, input.tagNames)
		: []
	const days = new Map<
		string,
		{ bookedOn: string; transactions: TransactionRow[]; totals: Map<string, bigint> }
	>()
	for (const row of filtered) {
		const day = days.get(row.bookedOn) ?? {
			bookedOn: row.bookedOn,
			transactions: [],
			totals: new Map<string, bigint>()
		}
		day.transactions.push(row)
		day.totals.set(row.currency, (day.totals.get(row.currency) ?? 0n) + BigInt(row.amountMinor))
		days.set(row.bookedOn, day)
	}
	const ordered = [...days.values()].sort((a, b) => b.bookedOn.localeCompare(a.bookedOn))
	const pageCount = Math.max(1, Math.ceil(filtered.length / LEDGER_PAGE_SIZE))
	const requested =
		Number.isSafeInteger(input.requestedPage) && input.requestedPage > 0 ? input.requestedPage : 1
	const page = Math.min(requested, pageCount)
	let skip = (page - 1) * LEDGER_PAGE_SIZE
	let remaining = LEDGER_PAGE_SIZE
	const groups = []
	for (const day of ordered) {
		if (remaining === 0) break
		if (skip >= day.transactions.length) {
			skip -= day.transactions.length
			continue
		}
		const rows = day.transactions.slice(skip, skip + remaining)
		skip = 0
		remaining -= rows.length
		groups.push({
			bookedOn: day.bookedOn,
			totals: [...day.totals].map(([currency, amountMinor]) => ({ currency, amountMinor })),
			rows: rows.map((row) => ({
				id: row.id,
				amountMinor: row.amountMinor,
				currency: row.currency,
				description: row.description?.slice(0, 4096) ?? null,
				categoryName: input.categoryNames.get(row.categoryId)?.slice(0, 4096) ?? null,
				tags: projectLedgerTags(
					input.tagNames.get(row.id) ?? [],
					input.tagCursor?.transactionId === row.id ? input.tagCursor.offset : 0
				)
			}))
		})
	}
	const start = page <= 3 ? 2 : page >= pageCount - 2 ? pageCount - 2 : page
	const end = page <= 3 ? 3 : page >= pageCount - 2 ? pageCount - 1 : page
	const slots =
		pageCount <= 5
			? Array.from({ length: pageCount }, (_, index) => index + 1)
			: [1, ...Array.from({ length: end - start + 1 }, (_, index) => start + index), pageCount]
	return { validRange, page, pageCount, total: filtered.length, slots, groups }
}

export function projectLedgerTags(names: readonly string[], requestedOffset: number) {
	const pageSize = 100
	const requested =
		Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
	const offset = Math.min(
		Math.floor(requested / pageSize) * pageSize,
		Math.max(0, Math.floor((names.length - 1) / pageSize) * pageSize)
	)
	return {
		offset,
		total: names.length,
		names: names.slice(offset, offset + pageSize).map((name) => name.slice(0, 4096)),
		hasMore: offset + pageSize < names.length
	}
}
