<script lang="ts">
	import type { Snippet } from 'svelte'
	import AppLink from '#lib/components/navigation/AppLink.svelte'
	import Icon from '../navigation/AppIcon.svelte'
	import ChevronRight from 'tdesign-icons-svg/src/chevron-right.svg?component'
	let {
		href,
		label,
		children,
		amount
	}: { href: string; label: string; children: Snippet; amount: Snippet } = $props()
	const labelId = $props.id()
</script>

<li>
	<div class="content">{@render children()}</div>
	{@render amount()}
	<AppLink {href}>
		{#snippet render(destination)}
			<a class="transaction-link" href={destination} aria-labelledby={labelId}
				><Icon icon={ChevronRight} /></a
			>
		{/snippet}
	</AppLink>
	<span id={labelId} class="link-label">{label}</span>
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
</style>
