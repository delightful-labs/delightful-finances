<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { getFinanceUiRuntime, type FinanceUiRuntime } from '#lib/runtime/finance-ui.js'
	import { m } from '#lib/paraglide/messages.js'
	import TransactionList from './TransactionList.svelte'
	import QueryContent from '../shared/QueryContent.svelte'
	import Message from '../shared/Message.svelte'

	let { runtime = getFinanceUiRuntime() }: { runtime?: FinanceUiRuntime } = $props()
	const state = $derived(fromStore(runtime.view))
	const workspace = $derived(state.current?.workspace)
	const view = $derived(workspace?.ledger)
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
			{#if !view.validRange}
				<Message message={m['errors.date_range_invalid']()} />
			{:else}
				<TransactionList
					projection={view}
					onTagPage={(transactionId, offset) =>
						runtime.send({
							type: 'LEDGER',
							generation,
							command: { type: 'TAG_PAGE', transactionId, offset }
						})}
				/>
			{/if}
		</QueryContent>
	{/key}
{/if}
