<script lang="ts">
	import { groupTransactionsByDate } from '#lib/domain/transaction-groups.js'
	import { app } from '#lib/schema.js'
	import { QuerySubscription } from 'jazz-tools/svelte'
	import { getContext, untrack } from 'svelte'
	import { page } from '$app/state'
	import { replaceState } from '$app/navigation'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import AccountCreation from '#lib/components/AccountCreation.svelte'
	import Message from '#lib/components/Message.svelte'
	import TransactionList from '#lib/components/TransactionList.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import PageContent from './PageContent.svelte'
	import FloatingActionLink from './FloatingActionLink.svelte'

	let { kind, showHeading = true }: { kind: 'income' | 'expense'; showHeading?: boolean } = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)

	const requestedPage = $derived.by(() => {
		const value = page.url.searchParams.get('page') ?? '1'
		const number = Number(value)
		return /^\d+$/.test(value) && Number.isSafeInteger(number) && number > 0 ? number : 1
	})
	function pageHref(number: number) {
		const url = new URL(page.url.href)
		if (number <= 1) url.searchParams.delete('page')
		else url.searchParams.set('page', String(number))
		return `${url.pathname}${url.search}${url.hash}`
	}
	function transactionHref(id: string) {
		const query = requestedPage > 1 ? `?page=${requestedPage}` : ''
		return `${kind === 'income' ? '/income' : '/expenses'}/${id}${query}`
	}
	const newHref = $derived(
		`${kind === 'income' ? '/income/new' : '/expenses/new'}${requestedPage > 1 ? `?page=${requestedPage}` : ''}`
	)

	let previousPaginationScope:
		{ organizationId: string | null; pathname: string; key: string } | undefined
	$effect(() => {
		const scope = {
			organizationId: filters.activeOrganizationId,
			pathname: page.url.pathname,
			key: JSON.stringify([filters.activeOrganizationId, kind, filters.selectedAccountIds])
		}
		const previous = previousPaginationScope
		previousPaginationScope = scope
		// Preserve a direct page link while the initial workspace is loading.
		if (
			previous?.organizationId &&
			previous.pathname === scope.pathname &&
			previous.key !== scope.key
		) {
			untrack(() => replaceState(pageHref(1), page.state))
		}
	})

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
	const categoryNames = $derived(
		new Map((categories.current ?? []).map((row) => [row.id, row.name]))
	)
	const tagNamesByTransaction = $derived(
		(links.current ?? []).reduce((result, link) => {
			const name = (tags.current ?? []).find((tag) => tag.id === link.tagId)?.name
			if (name) {
				const names = result.get(link.transactionId) ?? []
				result.set(link.transactionId, [...new Set([...names, name])])
			}
			return result
		}, new Map<string, string[]>())
	)
	const groups = $derived(groupTransactionsByDate(visibleTransactions))
</script>

<PageContent>
	{#if showHeading}<PageHeader
			title={kind === 'income' ? m['labels.income']() : m['labels.expenses']()}
		/>{/if}

	<QueryContent
		queries={[transactions, accounts, categories, tags, links]}
		loadingMessage={m['status.loading']({ subject: m['labels.transactions']() })}
		errorMessage={m['errors.load']({ subject: m['labels.transactions']() })}
	>
		{#if (accounts.current ?? []).filter((account) => !account.archivedAt).length === 0}
			<Message message={m['transactions.no_accounts']()} />
			<AccountCreation />
		{/if}
		{#key JSON.stringify([filters.activeOrganizationId, kind, filters.selectedAccountIds])}
			<TransactionList
				{groups}
				{requestedPage}
				{pageHref}
				{transactionHref}
				{categoryNames}
				{tagNamesByTransaction}
				noAccountsSelected={filters.selectedAccountIds !== null &&
					filters.selectedAccountIds.length === 0}
			/>
		{/key}
	</QueryContent>
</PageContent>

<FloatingActionLink
	href={newHref}
	label={m['actions.add']({
		name: kind === 'income' ? m['labels.income']() : m['labels.expenses']()
	})}
/>
