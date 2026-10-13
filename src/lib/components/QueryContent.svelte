<script lang="ts">
	import { LoadingSpinner } from 'delightful-ui'
	import type { Snippet } from 'svelte'
	import type { QuerySubscription } from 'jazz-tools/svelte'

	let {
		queries,
		loadingMessage,
		errorMessage,
		children
	}: {
		queries: readonly Pick<QuerySubscription<{ id: string }>, 'isLoading' | 'error'>[]
		loadingMessage: string
		errorMessage: string
		children: Snippet
	} = $props()

	const failed = $derived(queries.some((query) => query.error !== null))
	const loading = $derived(queries.some((query) => query.isLoading))
</script>

{#if failed}
	<p role="alert">{errorMessage}</p>
{:else if loading}
	<!-- Future StatusMessage: docs/delightful-ui-integration.md#status-feedback -->
	<div role="status">
		<LoadingSpinner role="presentation" aria-hidden="true" text="" />
		<p>{loadingMessage}</p>
	</div>
{:else}
	{@render children()}
{/if}
