<script lang="ts">
	import type { Snippet } from 'svelte'
	import { page } from '$app/state'
	import TransactionWorkspace from '#lib/components/TransactionWorkspace.svelte'
	import TransactionView from '#lib/components/TransactionView.svelte'

	let { children }: { children: Snippet } = $props()
	const kind = $derived(page.url.pathname.startsWith('/income') ? 'income' : 'expense')
	const index = $derived(page.url.pathname === '/income' || page.url.pathname === '/expenses')
</script>

<TransactionWorkspace {children} {index} {kind}>
	{#snippet list(showHeading)}
		<TransactionView {kind} {showHeading} />
	{/snippet}
</TransactionWorkspace>
