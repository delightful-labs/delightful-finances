<script lang="ts">
	import { Button, Dialog } from 'delightful-ui'
	import type { Snippet } from 'svelte'
	import { m } from '#lib/paraglide/messages.js'

	let {
		children,
		appId,
		serverUrl,
		browserOrigin,
		accountId
	}: {
		children: Snippet
		appId: string
		serverUrl: string
		browserOrigin?: string | undefined
		accountId?: string | undefined
	} = $props()
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
	<dl>
		<dt>{m['developer.browser_origin']()}</dt>
		<dd><code>{browserOrigin || m['developer.unavailable']()}</code></dd>
		<dt>{m['developer.jazz_app_id']()}</dt>
		<dd><code>{appId || m['developer.unavailable']()}</code></dd>
		<dt>{m['developer.jazz_server_url']()}</dt>
		<dd><code>{serverUrl || m['developer.unavailable']()}</code></dd>
		<dt>{m['developer.account_id']()}</dt>
		<dd><code>{accountId || m['developer.unavailable']()}</code></dd>
	</dl>
	{@render children()}
	<Button type="button" onclick={() => (open = false)}>{m['actions.close']()}</Button>
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
