<script lang="ts">
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { formatMoney } from '#lib/domain/money.js'
	import type { TransactionDay } from '#lib/domain/transaction-groups.js'
	import { m } from '#lib/paraglide/messages.js'
	import TransactionListItem from './TransactionListItem.svelte'

	let {
		groups,
		accountNames,
		categoryNames,
		tagNamesByTransaction,
		noAccountsSelected
	}: {
		groups: readonly TransactionDay[]
		accountNames: ReadonlyMap<string, string>
		categoryNames: ReadonlyMap<string, string>
		tagNamesByTransaction: ReadonlyMap<string, readonly string[]>
		noAccountsSelected: boolean
	} = $props()
	const listId = $props.id()
	const dateFormatter = $derived(
		new Intl.DateTimeFormat(getLocale(), {
			weekday: 'short',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			timeZone: 'UTC'
		})
	)
</script>

{#if noAccountsSelected}
	<p>{m['transactions.no_accounts_selected']()}</p>
{:else if groups.length === 0}
	<p>{m['transactions.empty.title']()}</p>
{:else}
	{#each groups as group (group.bookedOn)}
		<section aria-labelledby={`${listId}-${group.bookedOn}`}>
			<header>
				<h2 id={`${listId}-${group.bookedOn}`}>
					<time datetime={group.bookedOn}
						>{dateFormatter.format(new Date(`${group.bookedOn}T00:00:00Z`))}</time
					>
				</h2>
				<div class="totals">
					{#each [...group.totals] as [currency, amount] (currency)}
						<span
							aria-label={m['transactions.daily_total']({
								amount: formatMoney(amount, currency, getLocale())
							})}
						>
							{formatMoney(amount, currency, getLocale())}
						</span>
					{/each}
				</div>
			</header>
			<ul class="entries">
				{#each group.transactions as transaction (transaction.id)}
					<TransactionListItem
						{transaction}
						categoryName={categoryNames.get(transaction.categoryId)}
						accountName={accountNames.get(transaction.accountId)}
						tagNames={tagNamesByTransaction.get(transaction.id) ?? []}
					/>
				{/each}
			</ul>
		</section>
	{/each}
{/if}

<style>
	header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
		flex-wrap: wrap;
	}
	h2 {
		margin: 0;
	}
	section {
		margin-block: 1.5rem;
	}
	.entries {
		list-style: none;
		padding: 0;
	}
	p {
		margin-block: 0.25rem;
	}
	.totals {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
</style>
