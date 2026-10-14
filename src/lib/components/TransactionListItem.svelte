<script lang="ts">
	import type { TransactionRow } from '#lib/schema.js'
	import { formatMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		transaction,
		categoryName,
		accountName,
		tagNames = []
	}: {
		transaction: TransactionRow
		categoryName: string | undefined
		accountName: string | undefined
		tagNames?: readonly string[]
	} = $props()
</script>

<li>
	<div class="entry-heading">
		<div class="classification">
			<strong>{categoryName ?? m['transactions.category_unavailable']()}</strong>
			{#if tagNames.length}<span>{tagNames.join(', ')}</span>{/if}
		</div>
		<span>{formatMoney(transaction.amountMinor, transaction.currency, getLocale())}</span>
	</div>
	{#if transaction.memo}<p>{transaction.memo}</p>{/if}
	<small>{accountName ?? m['transactions.account_unavailable']()}</small>
</li>

<style>
	.entry-heading {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
		flex-wrap: wrap;
	}
	li {
		margin-block: 1rem;
	}
	p {
		margin-block: 0.25rem;
	}
	.classification {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
</style>
