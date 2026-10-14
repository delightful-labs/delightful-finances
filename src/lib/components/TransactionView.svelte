<script lang="ts">
	import { groupTransactionsByDate } from '#lib/domain/transaction-groups.js'
	import { app } from '#lib/schema.js'
	import { QuerySubscription } from 'jazz-tools/svelte'
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import TransactionList from '#lib/components/TransactionList.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'

	let { kind }: { kind: 'income' | 'expense' } = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)

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
</script>

<svelte:head>
	<title
		>{kind === 'income' ? m['labels.income']() : m['labels.expenses']()} · {m['app.name']()}</title
	>
</svelte:head>

<PageHeader
	title={kind === 'income' ? m['labels.income']() : m['labels.expenses']()}
	action={{
		href: kind === 'income' ? '/incomes/new' : '/expenses/new',
		label: kind === 'income' ? m['actions.add_income']() : m['actions.add_expense']()
	}}
/>

<QueryContent
	queries={[transactions, accounts, categories, tags, links]}
	loadingMessage={m['status.loading']({ subject: m['labels.transactions']() })}
	errorMessage={m['errors.load']({ subject: m['labels.transactions']() })}
>
	<TransactionList
		{groups}
		{accountNames}
		{categoryNames}
		{tagNamesByTransaction}
		noAccountsSelected={filters.selectedAccountIds !== null &&
			filters.selectedAccountIds.length === 0}
	/>
</QueryContent>
