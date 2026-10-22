<script lang="ts">
	import type { Snippet } from 'svelte'
	import { onNavigate } from '$app/navigation'
	import { page } from '$app/state'
	import TransactionWorkspace from '#lib/components/TransactionWorkspace.svelte'
	import TransactionView from '#lib/components/TransactionView.svelte'

	let { children }: { children: Snippet } = $props()
	const pathname = $derived(page.url.pathname)
	const kind = $derived(pathname.startsWith('/income') ? 'income' : 'expense')
	const index = $derived(pathname === '/income' || pathname === '/expenses')
	const listHref = $derived(
		page.params.id ? `${kind === 'income' ? '/income' : '/expenses'}${page.url.search}` : undefined
	)

	onNavigate((navigation) => {
		if (!navigation.to?.route.id?.startsWith('/(transactions)/')) return
		if (navigation.from?.url.pathname === navigation.to.url.pathname) return
		if (!document.startViewTransition) return
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

		return new Promise<void>((resolve) => {
			const transition = document.startViewTransition(async () => {
				// Let SvelteKit update the page after the browser captures the old view.
				resolve()
				await navigation.complete
			})
			// A skipped or failed capture must never hold up navigation.
			void transition.updateCallbackDone.catch(() => resolve())
		})
	})
</script>

<TransactionWorkspace {children} {index} {kind} {listHref}>
	{#snippet list(showHeading)}
		<TransactionView {kind} {showHeading} />
	{/snippet}
</TransactionWorkspace>

<style>
	:global(::view-transition-old(root)),
	:global(::view-transition-new(root)) {
		animation: none;
		mix-blend-mode: normal;
	}

	:global(::view-transition-group(transaction-content)) {
		animation: none;
	}

	:global(::view-transition-old(transaction-content)) {
		display: none;
	}

	:global(::view-transition-new(transaction-content)) {
		animation: transaction-slide-in 300ms ease-out both;
		mix-blend-mode: normal;
	}

	@keyframes -global-transaction-slide-in {
		from {
			transform: translateX(-100vw);
		}
		to {
			transform: translateX(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(::view-transition-new(transaction-content)) {
			animation: none;
		}
	}
</style>
