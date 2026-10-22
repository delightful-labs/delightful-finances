<script lang="ts">
	import AppLink from '#lib/components/AppLink.svelte'
	import { Button, ScreenReaderText } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	let {
		active = true,
		failed = false,
		loading = false,
		onRetry
	}: { active?: boolean; failed?: boolean; loading?: boolean; onRetry: () => void } = $props()
	const message = $derived(
		!active
			? ''
			: loading
				? m['status.loading']({ subject: m['labels.workspaces']() })
				: m['workspace.unavailable']()
	)
</script>

<ScreenReaderText role="status">{failed ? '' : message}</ScreenReaderText>
<ScreenReaderText role="alert">{failed ? message : ''}</ScreenReaderText>
{#if active && !loading}
	<p aria-hidden="true">{message}</p>
	<p><AppLink href="/settings/workspace">{m['workspace.choose']()}</AppLink></p>
	<Button type="button" onclick={onRetry}>{m['actions.retry']()}</Button>
{/if}
