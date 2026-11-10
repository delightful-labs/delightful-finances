<script lang="ts">
	import type { Snippet } from 'svelte'
	import { fromStore } from 'svelte/store'
	import { getFinanceUiRuntime, type FinanceUiRuntime } from '#lib/runtime/finance-ui.js'
	import type { OverviewCommand } from '#lib/runtime/worker/overview-protocol.js'
	import { m } from '#lib/paraglide/messages.js'
	import QueryContent from '../shared/QueryContent.svelte'
	import ExpenseOverview from './ExpenseOverview.svelte'

	let {
		runtime = getFinanceUiRuntime(),
		navigation
	}: { runtime?: FinanceUiRuntime; navigation?: Snippet } = $props()
	const state = $derived(fromStore(runtime.view))
	const workspace = $derived(state.current?.workspace)
	const view = $derived(workspace?.overview)
	let restoredGeneration = 0
	function send(generation: number, command: OverviewCommand) {
		runtime.send({ type: 'OVERVIEW', generation, command })
	}
	$effect(() => {
		if (!view?.active || !workspace?.organizationId || restoredGeneration === workspace.generation)
			return
		restoredGeneration = workspace.generation
		let value: string | null = null
		try {
			value = sessionStorage.getItem(`finance-overview-filters:${workspace.organizationId}`)
		} catch {
			/* Storage availability does not gate finance. */
		}
		send(workspace.generation, {
			type: 'RESTORE_FILTERS',
			value: value !== null && value.length > 16_384 ? null : value
		})
	})
	$effect(() => {
		if (!view?.active || !view.preferencesReady || !workspace?.organizationId) return
		const { start, end, categoryId, currency } = view.filters
		try {
			sessionStorage.setItem(
				`finance-overview-filters:${workspace.organizationId}`,
				JSON.stringify({ start, end, categoryId, currency })
			)
		} catch {
			/* Native preference storage is optional. */
		}
	})
</script>

{#if view?.active && workspace}
	{#key workspace.generation}
		{@const generation = workspace.generation}
		<QueryContent
			queries={[{ isLoading: view.loading, error: view.failed ? true : null }]}
			loadingMessage={m['status.loading_subject']({
				subject: m['nouns.transaction']({ count: 2 })
			})}
			errorMessage={m['errors.load_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
		>
			<ExpenseOverview
				{navigation}
				projection={view}
				onintent={(command) => send(generation, command)}
			/>
		</QueryContent>
	{/key}
{/if}
