<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { getFinanceUiRuntime, type FinanceUiRuntime } from '#lib/runtime/finance-ui.js'
	import type { AccountActionsIntent } from '#lib/runtime/worker/account-actions-protocol.js'
	import { m } from '#lib/paraglide/messages.js'
	import AccountList from './AccountList.svelte'
	import WorkerAccountCreation from './WorkerAccountCreation.svelte'
	import CatalogPager from '../navigation/CatalogPager.svelte'

	let { runtime = getFinanceUiRuntime() }: { runtime?: FinanceUiRuntime } = $props()
	const state = $derived(fromStore(runtime.view))
	const workspace = $derived(state.current?.workspace)
	const view = $derived(workspace?.accountActions)
	const generation = $derived(workspace?.generation ?? 0)
	// Formatting adapters consume bounded, already-calculated balances.
	const balances = $derived(
		view?.balancesReady
			? new Map(
					workspace?.accounts.flatMap((row) =>
						row.balanceMinor === null ? [] : [[row.id, row.balanceMinor]]
					)
				)
			: null
	)
	function send(generation: number, command: AccountActionsIntent) {
		if (generation > 0) runtime.send({ type: 'ACCOUNT_COMMAND', generation, command })
	}
</script>

<WorkerAccountCreation {runtime} />
{#if view && workspace}
	{#key generation}
		{@const displayedGeneration = generation}
		<AccountList
			view={view.archive}
			{balances}
			onArchive={(accountId) => send(displayedGeneration, { type: 'ARCHIVE_ACCOUNT', accountId })}
			deleteGrantView={{ ...view.deleteGrants, members: [], grants: [] }}
			grantQueries={[
				{ isLoading: view.permissionsLoading, error: view.permissionsFailed ? true : null }
			]}
			onActionsOpenChange={(open, accountId) =>
				send(displayedGeneration, { type: 'ACCOUNT_ACTIONS', open, accountId: accountId ?? null })}
			onDeleteGrant={(accountId, userId, canDelete) =>
				send(displayedGeneration, { type: 'SET_DELETE', accountId, userId, canDelete })}
		>
			{#snippet permissionControls()}
				<CatalogPager
					page={view.permissionPage}
					size={500}
					subject={m['nouns.permission']({ count: 2 })}
					onpage={(offset) =>
						send(displayedGeneration, { type: 'ACCOUNT_PERMISSIONS_PAGE', offset })}
				/>
			{/snippet}
		</AccountList>
		<CatalogPager
			page={workspace.accountPage}
			size={500}
			subject={m['nouns.account']({ count: 2 })}
			onpage={(offset) =>
				runtime.send({
					type: 'CATALOG_PAGE',
					generation: displayedGeneration,
					catalog: 'accounts',
					offset
				})}
		/>
	{/key}
{/if}
