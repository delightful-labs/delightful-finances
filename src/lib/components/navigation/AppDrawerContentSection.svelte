<script lang="ts">
	import type { Snippet } from 'svelte'

	let {
		element = 'div',
		'aria-labelledby': labelledBy,
		children
	}: {
		element?: 'div' | 'section'
		'aria-labelledby'?: string
		children: Snippet
	} = $props()
</script>

<svelte:element this={element} class="details-content-section" aria-labelledby={labelledBy}>
	{@render children()}
</svelte:element>

<style>
	.details-content-section {
		display: grid;
		gap: var(--dui-space-xs, 0.5rem);
		min-width: 0;
		padding: var(--dui-space-xs, 0.5rem) 1rem;
	}
</style>
