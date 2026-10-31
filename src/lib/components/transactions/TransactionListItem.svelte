<script lang="ts">
	import TransactionRowLayout from './TransactionRowLayout.svelte'
	import { Text } from 'delightful-ui'
	import type { TransactionRow } from '#lib/schema.js'
	import { formatMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		transaction,
		href,
		categoryName,
		tagNames = []
	}: {
		href: string
		transaction: TransactionRow
		categoryName: string | undefined
		tagNames?: readonly string[]
	} = $props()
	const tags = $derived(new Intl.ListFormat(getLocale(), { style: 'short', type: 'unit' }))
</script>

<TransactionRowLayout
	{href}
	label={`${m['labels.subject_details']({ subject: m['nouns.transaction']({ count: 1 }) })}: ${categoryName ?? m['status.unavailable_subject']({ subject: m['nouns.category']({ count: 1 }) })}, ${transaction.description ? `${transaction.description}, ` : ''}${formatMoney(transaction.amountMinor, transaction.currency, getLocale())}`}
>
	<div class="classification">
		<Text size="sm" as="span"
			><strong
				>{categoryName ??
					m['status.unavailable_subject']({ subject: m['nouns.category']({ count: 1 }) })}</strong
			></Text
		>
		{#if tagNames.length}<Text size="sm" as="span">{tags.format(tagNames)}</Text>{/if}
	</div>
	{#if transaction.description}<Text size="sm"><em>{transaction.description}</em></Text>{/if}
	{#snippet amount()}<Text size="sm" as="span"
			>{formatMoney(transaction.amountMinor, transaction.currency, getLocale())}</Text
		>{/snippet}
</TransactionRowLayout>

<style>
	.classification {
		display: flex;
		align-items: baseline;
		gap: var(--dui-spacing-xs);
		flex-wrap: wrap;
	}
</style>
