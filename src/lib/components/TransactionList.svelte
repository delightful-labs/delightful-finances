<script lang="ts">
	import { Heading, Text } from 'delightful-ui'
	import PageContent from './PageContent.svelte'
	import SplitRow from './SplitRow.svelte'
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
	<Text>{m['transactions.no_accounts_selected']()}</Text>
{:else if groups.length === 0}
	<Text>{m['transactions.empty.title']()}</Text>
{:else}
	<PageContent>
		{#each groups as group (group.bookedOn)}
			<section aria-labelledby={`${listId}-${group.bookedOn}`}>
				<header>
					<SplitRow>
						<Heading level="h2" id={`${listId}-${group.bookedOn}`}>
							<time datetime={group.bookedOn}
								>{dateFormatter.format(new Date(`${group.bookedOn}T00:00:00Z`))}</time
							>
						</Heading>
						{#snippet trailing()}
							<div class="totals">
								{#each [...group.totals] as [currency, amount] (currency)}
									<Text
										as="span"
										aria-label={m['transactions.daily_total']({
											amount: formatMoney(amount, currency, getLocale())
										})}
									>
										{formatMoney(amount, currency, getLocale())}
									</Text>
								{/each}
							</div>
						{/snippet}
					</SplitRow>
				</header>
				<ul class="entries">
					{#each group.transactions as transaction (transaction.id)}
						<TransactionListItem
							href={`/transactions/${transaction.id}`}
							{transaction}
							categoryName={categoryNames.get(transaction.categoryId)}
							accountName={accountNames.get(transaction.accountId)}
							tagNames={tagNamesByTransaction.get(transaction.id) ?? []}
						/>
					{/each}
				</ul>
			</section>
		{/each}
	</PageContent>
{/if}

<style>
	section {
		display: grid;
		gap: var(--dui-spacing-xs);
		min-inline-size: 0;
	}

	.entries {
		display: grid;
		gap: var(--dui-spacing-md);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.totals {
		display: flex;
		gap: var(--dui-spacing-xs);
		flex-wrap: wrap;
	}
</style>
