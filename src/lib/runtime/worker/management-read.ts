import type { ManagementObservation } from '../../contracts/management-contract.js'
import type { TransactionRow } from '../../schema.js'
import { selectManagementArchiveIds } from '../../machines/management/management.js'
import { MANAGEMENT_PAGE_SIZE, publicCategory, publicTag } from './management-protocol.js'

/** Complete readable history and authorization are processed before paging. */
export function projectManagementData(input: {
	category: ManagementObservation
	tag: ManagementObservation
	transactions: readonly Pick<TransactionRow, 'categoryId'>[]
	binding: object
	categoryOffset: number
	tagOffset: number
	categoryFilter: 'active' | 'archived' | 'all'
	tagFilter: 'active' | 'archived' | 'all'
	categoryOptionsKind: 'expense' | 'income'
	categoryOptionsOffset: number
}) {
	const facts = input.category
	const counts = new Map(facts.categories.map((row) => [row.id, { transactions: 0, tags: 0 }]))
	for (const row of input.transactions) {
		const count = counts.get(row.categoryId)
		if (count) count.transactions++
	}
	for (const row of facts.tags) {
		const count = row.categoryId ? counts.get(row.categoryId) : undefined
		if (count) count.tags++
	}
	const names = new Map(facts.categories.map((row) => [row.id, row.name]))
	const categoryIds = new Set(selectManagementArchiveIds(facts, input.binding, 'archiveCategory'))
	const tagIds = new Set(selectManagementArchiveIds(input.tag, input.binding, 'archiveTag'))
	const offset = (requested: number, length: number) =>
		Math.min(
			Math.floor(requested / MANAGEMENT_PAGE_SIZE) * MANAGEMENT_PAGE_SIZE,
			Math.max(0, Math.floor((length - 1) / MANAGEMENT_PAGE_SIZE) * MANAGEMENT_PAGE_SIZE)
		)
	const visible = (row: { archivedAt: Date | null }, filter: 'active' | 'archived' | 'all') =>
		filter === 'all' || (filter === 'archived' ? row.archivedAt !== null : row.archivedAt === null)
	const categories = facts.categories.filter((row) => visible(row, input.categoryFilter))
	const tags = facts.tags.filter((row) => visible(row, input.tagFilter))
	const categoryOptions = facts.categories
		.filter(
			(row) =>
				row.organizationId === facts.organizationId &&
				row.archivedAt === null &&
				row.kind === input.categoryOptionsKind
		)
		.toSorted((a, b) => a.name.localeCompare(b.name))
	const categoryOptionsOffset = offset(input.categoryOptionsOffset, categoryOptions.length)
	const categoryOffset = offset(input.categoryOffset, categories.length)
	const tagOffset = offset(input.tagOffset, tags.length)
	return {
		categories: categories
			.slice(categoryOffset, categoryOffset + MANAGEMENT_PAGE_SIZE)
			.map((row) => ({
				...publicCategory(row),
				transactionCount: counts.get(row.id)?.transactions ?? 0,
				tagCount: counts.get(row.id)?.tags ?? 0,
				archivable: categoryIds.has(row.id)
			})),
		tags: tags.slice(tagOffset, tagOffset + MANAGEMENT_PAGE_SIZE).map((row) => ({
			...publicTag(row),
			categoryName: row.categoryId ? (names.get(row.categoryId)?.slice(0, 4096) ?? null) : null,
			archivable: tagIds.has(row.id)
		})),
		categoryPage: {
			offset: categoryOffset,
			total: categories.length,
			hasMore: categoryOffset + MANAGEMENT_PAGE_SIZE < categories.length
		},
		tagPage: {
			offset: tagOffset,
			total: tags.length,
			hasMore: tagOffset + MANAGEMENT_PAGE_SIZE < tags.length
		},
		categoryFilter: input.categoryFilter,
		tagFilter: input.tagFilter,
		tagRecordCount: facts.tags.length,
		categoryOptionsKind: input.categoryOptionsKind,
		categoryOptions: categoryOptions
			.slice(categoryOptionsOffset, categoryOptionsOffset + MANAGEMENT_PAGE_SIZE)
			.map(publicCategory),
		categoryOptionsPage: {
			offset: categoryOptionsOffset,
			total: categoryOptions.length,
			hasMore: categoryOptionsOffset + MANAGEMENT_PAGE_SIZE < categoryOptions.length
		},
		loading: facts.loading,
		failed: facts.failed,
		tagLoading: input.tag.loading,
		tagFailed: input.tag.failed
	}
}
