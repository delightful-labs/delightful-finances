<script lang="ts">
	import { Button, Dialog } from 'delightful-ui'
	import type { Snippet } from 'svelte'
	import { m } from '#lib/paraglide/messages.js'
	import PageContent from './PageContent.svelte'

	let { children }: { children: Snippet } = $props()
	let open = $state(false)
	const dialogId = $props.id()
</script>

<button
	class="developer-trigger"
	type="button"
	aria-haspopup="dialog"
	aria-controls={dialogId}
	onclick={() => (open = true)}
>
	{m['developer.menu']()}
</button>

<Dialog id={dialogId} heading={m['developer.menu']()} bind:open closedby="any">
	<PageContent>
		{@render children()}
		<Button type="button" onclick={() => (open = false)}>{m['developer.close']()}</Button>
	</PageContent>
</Dialog>

<style>
	.developer-trigger {
		position: fixed;
		inset-block-start: var(--dui-spacing-xs);
		inset-inline-start: var(--dui-spacing-xs);
		z-index: 100;
	}

	.developer-trigger:not(:focus) {
		inline-size: 1px;
		block-size: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
</style>
