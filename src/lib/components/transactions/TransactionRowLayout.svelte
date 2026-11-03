<script lang="ts">
	import type { Snippet } from 'svelte'
	import { LinkedListRow } from 'delightful-ui'
	import AppLink from '#lib/components/navigation/AppLink.svelte'

	let {
		href,
		label,
		children,
		amount
	}: { href: string; label: string; children: Snippet; amount: Snippet } = $props()
</script>

<AppLink {href}>
	{#snippet render(destination)}
		<LinkedListRow
			href={destination}
			{label}
			{children}
			trailing={amount}
			class="transaction-link"
		/>
	{/snippet}
</AppLink>
