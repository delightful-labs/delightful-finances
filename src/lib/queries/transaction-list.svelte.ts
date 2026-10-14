import { QuerySubscription } from 'jazz-tools/svelte'
import { app } from '#lib/schema.js'
import { groupTransactionsByDate } from '#lib/domain/transaction-groups.js'
import type { FinanceFilters } from '#lib/finance-filters.js'

export function createTransactionListState(kind: 'expense' | 'income', filters: FinanceFilters) {
	const transactions = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.transactions
					.where({ organizationId: filters.activeOrganizationId, kind })
					.orderBy('bookedOn', 'desc')
			: undefined
	)
	const visibleTransactions = $derived(
		(transactions.current ?? []).filter(
			(transaction) =>
				filters.selectedAccountIds === null ||
				filters.selectedAccountIds.includes(transaction.accountId)
		)
	)
	const accounts = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const categories = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const tags = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.tags.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const links = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.transactionTags.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const accountNames = $derived(new Map((accounts.current ?? []).map((row) => [row.id, row.name])))
	const categoryNames = $derived(
		new Map((categories.current ?? []).map((row) => [row.id, row.name]))
	)
	const tagNamesByTransaction = $derived.by(() => {
		const names = new Map((tags.current ?? []).map((tag) => [tag.id, tag.name]))
		const result = new Map<string, string[]>()
		for (const link of links.current ?? []) {
			const name = names.get(link.tagId)
			if (!name) continue
			const selected = result.get(link.transactionId) ?? []
			if (!selected.includes(name)) selected.push(name)
			result.set(link.transactionId, selected)
		}
		return result
	})
	const groups = $derived(groupTransactionsByDate(visibleTransactions))

	return {
		queries: [transactions, accounts, categories, tags, links],
		get groups() {
			return groups
		},
		get accountNames() {
			return accountNames
		},
		get categoryNames() {
			return categoryNames
		},
		get tagNamesByTransaction() {
			return tagNamesByTransaction
		},
		get noAccountsSelected() {
			return filters.selectedAccountIds !== null && filters.selectedAccountIds.length === 0
		}
	}
}
