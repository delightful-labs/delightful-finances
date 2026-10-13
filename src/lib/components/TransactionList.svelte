<script lang="ts">
	import { getContext } from 'svelte'
	import { QuerySubscription } from 'jazz-tools/svelte'
	import { formatMoney } from '#lib/domain/money.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import { app } from '#lib/schema.js'
	import QueryContent from './QueryContent.svelte'

	let { kind }: { kind: 'expense' | 'income' } = $props()
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
</script>

<svelte:head>
	<title
		>{kind === 'expense' ? m['labels.expenses']() : m['labels.income']()} · {m['app.name']()}</title
	>
</svelte:head>

<h1>{kind === 'expense' ? m['labels.expenses']() : m['labels.income']()}</h1>
<p>
	<a href={kind === 'expense' ? '/expenses/new' : '/incomes/new'}>
		{kind === 'expense' ? m['actions.add_expense']() : m['actions.add_income']()}
	</a>
</p>

<QueryContent
	queries={[transactions]}
	loadingMessage={m['status.loading']({ subject: m['labels.transactions']() })}
	errorMessage={m['errors.load']({ subject: m['labels.transactions']() })}
>
	{#if filters.selectedAccountIds !== null && filters.selectedAccountIds.length === 0}
		<p>{m['transactions.no_accounts_selected']()}</p>
	{:else if visibleTransactions.length === 0}
		<p>{m['transactions.empty.title']()}</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th scope="col">{m['labels.date']()}</th>
					<th scope="col">{m['labels.amount']()}</th>
					<th scope="col">{m['labels.memo']()}</th>
				</tr>
			</thead>
			<tbody>
				{#each visibleTransactions as transaction (transaction.id)}
					<tr>
						<td>{transaction.bookedOn}</td>
						<td>{formatMoney(transaction.amountMinor, transaction.currency)}</td>
						<td>{transaction.memo ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</QueryContent>
