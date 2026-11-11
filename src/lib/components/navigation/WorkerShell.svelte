<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { onMount, setContext, type Snippet } from 'svelte'
	import { page } from '$app/state'
	import { getFinanceUiRuntime } from '#lib/runtime/finance-ui.js'
	import { queryLinksKey, type QueryLinkContext } from '#lib/filters/query-links.js'
	import AppShell from './AppShell.svelte'
	import WorkerAccountCreation from '../accounts/WorkerAccountCreation.svelte'
	import CatalogPager from './CatalogPager.svelte'
	import { m } from '#lib/paraglide/messages.js'
	let { children }: { children: Snippet } = $props()
	const runtime = getFinanceUiRuntime()
	const snapshot = $derived(fromStore(runtime.view))
	const workspace = $derived(snapshot.current?.workspace)
	const accounts = $derived(workspace?.accounts ?? [])
	const balances = $derived(
		workspace?.queries.balancesLoading || workspace?.queries.balancesFailed
			? null
			: new Map(
					accounts.flatMap((row) => (row.balanceMinor === null ? [] : [[row.id, row.balanceMinor]]))
				)
	)
	const selected = $derived(
		workspace?.allAccountsSelected
			? null
			: accounts.filter((row) => row.selected).map((row) => row.id)
	)
	let offline = $state(false)
	onMount(() => {
		const changed = () => {
			offline = !navigator.onLine
		}
		changed()
		window.addEventListener('online', changed)
		window.addEventListener('offline', changed)
		return () => {
			window.removeEventListener('online', changed)
			window.removeEventListener('offline', changed)
		}
	})
	setContext<QueryLinkContext>(queryLinksKey, {
		get href() {
			return page.url.href
		},
		keys: ['workspace']
	})
</script>

{#if workspace}
	<AppShell
		{accounts}
		accountBalances={balances}
		organizations={workspace.organizations}
		organizationId={workspace.organizationId}
		selectedAccountIds={selected}
		browserOffline={offline}
		syncConfigured
		organizationQueries={[
			{
				isLoading: workspace.queries.organizationsLoading,
				error: workspace.queries.organizationsFailed ? true : null
			}
		]}
		accountQueries={[
			{
				isLoading: workspace.queries.accountsLoading,
				error: workspace.queries.accountsFailed ? true : null
			}
		]}
		onOrganizationChange={(workspaceId) =>
			runtime.send({
				type: 'WORKSPACE',
				generation: workspace.generation,
				command: { type: 'SELECT_WORKSPACE', workspaceId }
			})}
		onAccountChange={(accountId, selected) =>
			runtime.send({
				type: 'LEDGER',
				generation: workspace.generation,
				command: { type: 'SET_ACCOUNT', accountId, selected }
			})}
		onAllAccountsChange={(selected) =>
			runtime.send({
				type: 'LEDGER',
				generation: workspace.generation,
				command: { type: selected ? 'ALL_ACCOUNTS' : 'NO_ACCOUNTS' }
			})}
		editingAccountOrder={false}
		canToggleAccountOrder={false}
		canMoveAccount={() => false}
		onEditAccountOrder={() => {}}
		onDoneAccountOrder={() => {}}
		onMoveAccount={() => {}}
	>
		{#snippet accountCreation(trigger)}<WorkerAccountCreation {trigger} />
			<CatalogPager
				page={workspace.accountPage}
				size={500}
				subject={m['nouns.account']({ count: 2 })}
				onpage={(offset) =>
					runtime.send({
						type: 'CATALOG_PAGE',
						generation: workspace.generation,
						catalog: 'accounts',
						offset
					})}
			/>
			<CatalogPager
				page={workspace.organizationPage}
				size={500}
				subject={m['nouns.workspace']({ count: 2 })}
				onpage={(offset) =>
					runtime.send({
						type: 'CATALOG_PAGE',
						generation: workspace.generation,
						catalog: 'organizations',
						offset
					})}
			/>
		{/snippet}
		{@render children()}
	</AppShell>
{/if}
