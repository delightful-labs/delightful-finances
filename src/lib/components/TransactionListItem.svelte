<script lang="ts">
	import AppLink from '#lib/components/AppLink.svelte'
	import { Text } from 'delightful-ui'
	import Icon from './AppIcon.svelte'
	import ChevronRight from 'tdesign-icons-svg/src/chevron-right.svg?component'
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
	const labelId = $props.id()
	const tags = $derived(new Intl.ListFormat(getLocale(), { style: 'short', type: 'unit' }))
</script>

<li>
	<div class="content">
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
	</div>
	<Text size="sm" as="span"
		>{formatMoney(transaction.amountMinor, transaction.currency, getLocale())}</Text
	>
	<AppLink {href}>
		{#snippet render(destination)}
			<a class="transaction-link" href={destination} aria-labelledby={labelId}>
				<Icon icon={ChevronRight} />
			</a>
		{/snippet}
	</AppLink>
	<span id={labelId} class="link-label"
		>{m['labels.subject_details']({ subject: m['nouns.transaction']({ count: 1 }) })}: {categoryName ??
			m['status.unavailable_subject']({ subject: m['nouns.category']({ count: 1 }) })}, {transaction.description
			? `${transaction.description}, `
			: ''}{formatMoney(transaction.amountMinor, transaction.currency, getLocale())}</span
	>
</li>

<style>
	li {
		--dui-text-color: currentColor;
		font-size: var(--dui-font-size-sm);
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: baseline;
		gap: var(--dui-spacing-xs) var(--dui-spacing-md);
		padding: var(--dui-spacing-xs);
	}

	.content {
		display: grid;
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}

	.transaction-link {
		color: inherit;
		display: inline-flex;
		align-self: start;
		align-items: center;
		justify-content: center;
		min-inline-size: 24px;
		min-block-size: 24px;
		text-decoration: none;
	}

	li:hover {
		color: var(--dui-color-on-accent);
		background-color: var(--dui-color-accent);
	}

	.transaction-link::after {
		content: '';
		position: absolute;
		inset: 0;
	}

	.transaction-link:focus-visible {
		outline: none;
	}

	.transaction-link:focus-visible::after {
		outline: 2px solid var(--dui-color-focus, currentColor);
		outline-offset: 2px;
	}

	.link-label {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.classification {
		display: flex;
		align-items: baseline;
		gap: var(--dui-spacing-xs);
		flex-wrap: wrap;
	}
</style>
