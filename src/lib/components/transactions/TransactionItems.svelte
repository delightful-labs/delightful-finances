<script lang="ts">
	import LedgerPagination from './LedgerPagination.svelte'
	import CatalogPager from '../navigation/CatalogPager.svelte'
	import { m } from '#lib/paraglide/messages.js'
	import type { PublicLedgerView } from '#lib/runtime/worker/ledger-protocol.js'
	import TransactionListItem from './TransactionListItem.svelte'
	import type { TransactionRow } from '#lib/schema.js'
	let {
		transactions = [],
		categoryNames = new Map(),
		tagNamesByTransaction = new Map(),
		transactionHref = () => '',
		projection,
		onTagPage
	}: {
		transactions?: readonly TransactionRow[]
		categoryNames?: ReadonlyMap<string, string>
		tagNamesByTransaction?: ReadonlyMap<string, readonly string[]>
		transactionHref?: (id: string) => string
		projection?: PublicLedgerView
		onTagPage?: (transactionId: string, offset: number) => void
	} = $props()
</script>

<ul class="transactions" aria-live="polite">
	{#each projection?.groups ?? [] as group (group.bookedOn)}
		{#each group.rows as row (row.id)}
			<TransactionListItem
				transaction={row}
				href={row.href}
				categoryName={row.categoryName}
				tagNames={row.tags.names}
			>
				{#if onTagPage}<CatalogPager
						page={row.tags}
						size={100}
						subject={m['nouns.tag']({ count: 2 })}
						onpage={(offset) => onTagPage?.(row.id, offset)}
					/>{/if}
			</TransactionListItem>
		{/each}
	{/each}
	{#each transactions as transaction (transaction.id)}<TransactionListItem
			{transaction}
			href={transactionHref(transaction.id)}
			categoryName={categoryNames.get(transaction.categoryId)}
			tagNames={tagNamesByTransaction.get(transaction.id) ?? []}
		/>{/each}
</ul>
{#if projection}<LedgerPagination view={projection} />{/if}

<style>
	.transactions {
		list-style: none;
		padding: 0;
	}
</style>
