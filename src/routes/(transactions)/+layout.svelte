<script lang="ts">
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()
	import { transactionKindForPath, transactionPages } from '#lib/domain/transaction-kind.js'
	import { m } from '#lib/paraglide/messages.js'
	import type { Snippet } from 'svelte'
	import { onNavigate } from '$app/navigation'
	import { page } from '$app/state'
	import TransactionWorkspace from '#lib/components/transactions/TransactionWorkspace.svelte'
	import WorkerLedger from '#lib/components/transactions/WorkerLedger.svelte'
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import FloatingActionLink from '#lib/components/navigation/FloatingActionLink.svelte'
	import TransactionListFilters from '#lib/components/filters/TransactionListFilters.svelte'
	import CatalogPager from '#lib/components/navigation/CatalogPager.svelte'
	import { getFinanceUiRuntime } from '#lib/runtime/finance-ui.js'
	import { fromStore } from 'svelte/store'
	import { goto } from '$app/navigation'
	import type { TransactionListFilters as ListFilters } from '#lib/filters/transaction-list-filters.js'

	let { children }: { children: Snippet } = $props()
	const pathname = $derived(page.url.pathname)
	const kind = $derived(transactionKindForPath(pathname))
	const config = $derived(transactionPages[kind])
	const heading = $derived(m[config.noun]({ count: config.count }))
	const index = $derived(pathname === config.path)
	const listHref = $derived(page.params.id ? `${config.path}${page.url.search}` : undefined)
	const runtime = getFinanceUiRuntime(),
		snapshot = fromStore(runtime.view)
	const workspace = $derived(snapshot.current?.workspace)
	const ledger = $derived(workspace?.ledger)
	const categories = $derived(
		new Map(ledger?.categories.map((row) => [row.id, row.name ?? '']) ?? [])
	)
	function changeFilters(value: ListFilters) {
		const destination = new URL(page.url.href)
		for (const [key, text] of Object.entries({
			start: value.start,
			end: value.end,
			category: value.categoryId,
			currency: value.currency,
			q: value.query
		})) {
			if (text) destination.searchParams.set(key, text)
			else destination.searchParams.delete(key)
		}
		destination.searchParams.delete('page')
		void goto(`${destination.pathname}${destination.search}${destination.hash}`, {
			replace: true,
			reset: false
		})
	}

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

<TransactionWorkspace
	{navigation}
	{children}
	{index}
	{heading}
	drawerHeading={m['nouns.transaction']({ count: 2 })}
	{listHref}
>
	{#snippet list(showHeading, navigation, closeControl)}
		<PageLayout {navigation}>
			{#snippet pageHeading()}
				{#if ledger}
					<TransactionListFilters
						{closeControl}
						title={showHeading ? heading : m['nouns.transaction']({ count: 2 })}
						headingLevel={showHeading ? 'h1' : 'h2'}
						value={ledger.filters}
						{categories}
						currencies={ledger.currencies}
						onchange={changeFilters}
					/>
				{/if}
			{/snippet}
			<WorkerLedger />
			{#if workspace && ledger}
				{#each [{ catalog: 'categories', page: ledger.categoryPage, subject: m['nouns.category']( { count: 2 } ) }, { catalog: 'currencies', page: ledger.currencyPage, subject: m['labels.currency']() }] as item (item.catalog)}
					<CatalogPager
						page={item.page}
						size={500}
						subject={item.subject}
						onpage={(offset) => {
							if (item.catalog === 'categories' || item.catalog === 'currencies')
								runtime.send({
									type: 'LEDGER',
									generation: workspace.generation,
									command: { type: 'OPTIONS_PAGE', catalog: item.catalog, offset }
								})
						}}
					/>
				{/each}
			{/if}
			<FloatingActionLink
				href={`${config.path}/new${page.url.search}`}
				label={m['actions.add_subject']({ subject: heading })}
			/>
		</PageLayout>
	{/snippet}
</TransactionWorkspace>

<style>
	:global {
		::view-transition-old(root),
		::view-transition-new(root) {
			animation: none;
			mix-blend-mode: normal;
		}

		::view-transition-group(transaction-content) {
			animation: none;
		}

		::view-transition-old(transaction-content) {
			display: none;
		}

		::view-transition-new(transaction-content) {
			animation: transaction-slide-in 300ms ease-out both;
			mix-blend-mode: normal;
		}

		@media (prefers-reduced-motion: reduce) {
			::view-transition-new(transaction-content) {
				animation: none;
			}
		}
	}

	@keyframes -global-transaction-slide-in {
		from {
			transform: translateX(-100vw);
		}
		to {
			transform: translateX(0);
		}
	}
</style>
