<script lang="ts">
	import type { Snippet } from 'svelte'

	let { children }: { children: Snippet } = $props()
</script>

<div class="page-content">{@render children()}</div>

<style>
	.page-content {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		gap: var(--dui-spacing-md);
		min-inline-size: 0;
	}
</style>
