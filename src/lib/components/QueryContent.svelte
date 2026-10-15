<script lang="ts">
	import { StatusMessage } from 'delightful-ui'
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
	<StatusMessage variant="error" text={errorMessage} />
{:else if loading}
	<StatusMessage variant="loading" text={loadingMessage} />
{:else}
	{@render children()}
{/if}
