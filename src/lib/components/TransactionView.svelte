<script lang="ts">
	import { transactionTagNames } from '#lib/domain/transaction-tags.js'
	import type { TransactionKind } from '#lib/domain/transaction-kind.js'
	import { groupTransactionsByDate } from '#lib/domain/transaction-groups.js'
	import { withQueryParams } from '#lib/domain/query-params.js'
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

	let {
		kind,
		heading,
		listPath,
		showHeading = true
	}: {
		kind: TransactionKind
		heading: string
		listPath: string
		showHeading?: boolean
	} = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)

	const requestedPage = $derived.by(() => {
		const value = page.url.searchParams.get('page') ?? '1'
		const number = Number(value)
		return /^\d+$/.test(value) && Number.isSafeInteger(number) && number > 0 ? number : 1
	})
	function pageHref(number: number) {
		return withQueryParams(`${page.url.pathname}${page.url.search}${page.url.hash}`, {
			page: number > 1 ? number : null
		})
	}
	function transactionHref(id: string) {
		return withQueryParams(`${listPath}/${encodeURIComponent(id)}`, {
			page: requestedPage > 1 ? requestedPage : null
		})
	}
	const newHref = $derived(
		withQueryParams(`${listPath}/new`, {
			page: requestedPage > 1 ? requestedPage : null
		})
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
	const reportedQueryErrors = new WeakSet<Error>()
	$effect(() => {
		const queries = { transactions, accounts, categories, tags, transactionTags: links }
		for (const [query, subscription] of Object.entries(queries)) {
			const error = subscription.error
			if (!error || reportedQueryErrors.has(error)) continue
			reportedQueryErrors.add(error)
			// Log error details only, never query parameters or finance records.
			console.error('[Jazz transaction view] Query failed', {
				query,
				kind,
				name: error.name,
				message: error.message,
				stack: error.stack,
				userAgent: navigator.userAgent
			})
		}
	})
	const categoryNames = $derived(
		new Map((categories.current ?? []).map((row) => [row.id, row.name]))
	)
	const tagNamesByTransaction = $derived(
		transactionTagNames(tags.current ?? [], links.current ?? [])
	)
	const groups = $derived(groupTransactionsByDate(visibleTransactions))
</script>

<PageContent>
	{#if showHeading}<PageHeader title={heading} />{/if}

	<QueryContent
		queries={[transactions, accounts, categories, tags, links]}
		loadingMessage={m['status.loading_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
		errorMessage={m['errors.load_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
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
	label={m['actions.add_subject']({
		subject: heading
	})}
/>
