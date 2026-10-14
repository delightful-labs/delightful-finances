<script lang="ts">
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { createTransactionListState } from '#lib/queries/transaction-list.svelte.js'
	import { m } from '#lib/paraglide/messages.js'
	import TransactionList from '#lib/components/TransactionList.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const content = createTransactionListState('income', filters)
</script>

<svelte:head>
	<title>{m['labels.income']()} · {m['app.name']()}</title>
</svelte:head>

<PageHeader
	title={m['labels.income']()}
	action={{ href: '/incomes/new', label: m['actions.add_income']() }}
/>

<QueryContent
	queries={content.queries}
	loadingMessage={m['status.loading']({ subject: m['labels.transactions']() })}
	errorMessage={m['errors.load']({ subject: m['labels.transactions']() })}
>
	<TransactionList
		groups={content.groups}
		accountNames={content.accountNames}
		categoryNames={content.categoryNames}
		tagNamesByTransaction={content.tagNamesByTransaction}
		noAccountsSelected={content.noAccountsSelected}
	/>
</QueryContent>
