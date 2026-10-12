<script lang="ts">
	import { getContext, onMount } from 'svelte'
	import { getDb } from 'jazz-tools/svelte'
	import { app, type Account } from '#lib/schema.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'

	let accounts = $state<Account[]>([])
	let loadError = $state(false)
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const visibleAccounts = $derived(
		accounts.filter((account) => account.organizationId === filters.activeOrganizationId)
	)

	onMount(() =>
		getDb().subscribe(app.accounts.orderBy('name'), {
			onUpdate: (rows) => {
				accounts = rows.filter((account) => account.archivedAt == null)
				loadError = false
			},
			onError: () => {
				loadError = true
			}
		})
	)
</script>

<svelte:head>
	<title>{m['labels.accounts']()} · {m['app.name']()}</title>
</svelte:head>

<h1>{m['labels.accounts']()}</h1>
<p><a href="/accounts/new">{m['actions.add_account']()}</a></p>

{#if loadError}
	<p role="alert">{m['accounts.load_error']()}</p>
{:else if visibleAccounts.length === 0}
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
