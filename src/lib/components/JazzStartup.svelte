<script lang="ts">
	import { Button, Icon, LoadingScreen } from 'delightful-ui'
	import RefreshIcon from 'tdesign-icons-svg/src/refresh.svg?component'
	import { m } from '#lib/paraglide/messages.js'

	let {
		error = false,
		workspace = false,
		onRetry
	}: {
		error?: boolean
		workspace?: boolean
		onRetry?: () => void
	} = $props()
</script>

<main class:recoverable={error && Boolean(onRetry)}>
	<LoadingScreen
		style={error && onRetry ? '--dui-loading-screen-min-height: auto' : undefined}
		variant={error ? 'error' : 'loading'}
		text={workspace && error
			? m['workspace.setup_error']()
			: workspace
				? m['workspace.loading']()
				: error
					? m['database.start_error']()
					: m['database.starting']()}
	/>
	{#if error && onRetry}
		<Button type="button" onclick={onRetry}>
			<Icon style="width: 1em; height: 1em;"><RefreshIcon /></Icon>
			{m['actions.retry']()}
		</Button>
	{/if}
</main>

<style>
	.recoverable {
		min-block-size: 100dvh;
		display: grid;
		align-content: center;
		justify-items: center;
		gap: var(--dui-space-sm, 1rem);
	}
</style>
