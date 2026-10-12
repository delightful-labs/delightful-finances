<script lang="ts">
	import { getContext, onMount } from 'svelte'
	import { getDb } from 'jazz-tools/svelte'
	import { formatMoney } from '#lib/domain/money.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import { app, type TransactionRow } from '#lib/schema.js'

	let { kind }: { kind: 'expense' | 'income' } = $props()
	let transactions = $state<TransactionRow[]>([])
	let loadError = $state(false)
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const visibleTransactions = $derived(
		transactions.filter(
			(transaction) =>
				transaction.kind === kind &&
				transaction.organizationId === filters.activeOrganizationId &&
				(filters.selectedAccountIds === null ||
					filters.selectedAccountIds.includes(transaction.accountId))
		)
	)

	onMount(() =>
		getDb().subscribe(app.transactions.orderBy('bookedOn', 'desc'), {
			onUpdate: (rows) => {
				transactions = rows
				loadError = false
			},
			onError: () => {
				loadError = true
			}
		})
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

{#if loadError}
	<p role="alert">{m['transactions.load_error']()}</p>
{:else if filters.selectedAccountIds !== null && filters.selectedAccountIds.length === 0}
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
