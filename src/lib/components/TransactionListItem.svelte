<script lang="ts">
	import { Text } from 'delightful-ui'
	import SplitRow from './SplitRow.svelte'
	import type { TransactionRow } from '#lib/schema.js'
	import { formatMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		transaction,
		href,
		categoryName,
		accountName,
		tagNames = []
	}: {
		href: string
		transaction: TransactionRow
		categoryName: string | undefined
		accountName: string | undefined
		tagNames?: readonly string[]
	} = $props()
	const tags = $derived(new Intl.ListFormat(getLocale(), { style: 'short', type: 'unit' }))
</script>

<li>
	<a {href}>
		<SplitRow>
			<div class="classification">
				<Text as="span"
					><strong
						>{categoryName ??
							m['transactions.unavailable_item']({ subject: m['labels.category']() })}</strong
					></Text
				>
				{#if tagNames.length}<Text as="span">{tags.format(tagNames)}</Text>{/if}
			</div>
			{#snippet trailing()}
				<Text as="span"
					>{formatMoney(transaction.amountMinor, transaction.currency, getLocale())}</Text
				>
			{/snippet}
		</SplitRow>
		{#if transaction.memo}<Text>{transaction.memo}</Text>{/if}
		<Text size="sm">{accountName ?? m['transactions.account_unavailable']()}</Text>
	</a>
</li>

<style>
	a {
		display: grid;
		gap: var(--dui-spacing-xxs);
	}

	.classification {
		display: flex;
		align-items: baseline;
		gap: var(--dui-spacing-xs);
		flex-wrap: wrap;
	}
</style>
