<script lang="ts">
	import { getContext } from 'svelte'
	import { QuerySubscription } from 'jazz-tools/svelte'
	import { app } from '#lib/schema.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import QueryContent from './QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const accounts = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const visibleAccounts = $derived(accounts.current ?? [])
</script>

<svelte:head>
	<title>{m['labels.accounts']()} · {m['app.name']()}</title>
</svelte:head>

<h1>{m['labels.accounts']()}</h1>
<p><a href="/accounts/new">{m['actions.add_account']()}</a></p>

<QueryContent
	queries={[accounts]}
	loadingMessage={m['accounts.loading']()}
	errorMessage={m['accounts.load_error']()}
>
	{#if visibleAccounts.length === 0}
		<p>{m['accounts.empty.title']()}</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th scope="col">{m['labels.account_name']()}</th>
					<th scope="col">{m['labels.account_type']()}</th>
					<th scope="col">{m['labels.currency']()}</th>
				</tr>
			</thead>
			<tbody>
				{#each visibleAccounts as account (account.id)}
					<tr>
						<td>{account.name}</td>
						<td>
							{account.kind === 'cash'
								? m['accounts.type.cash']()
								: account.kind === 'bank'
									? m['accounts.type.bank']()
									: m['accounts.type.card']()}
						</td>
						<td>{account.currency}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</QueryContent>
