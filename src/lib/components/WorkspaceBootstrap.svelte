<script lang="ts">
	import { app } from '#lib/schema.js'
	import { QuerySubscription } from 'jazz-tools/svelte'
	import { getDb } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { getContext, onMount, type Snippet } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import BankSyncIntegration from './BankSyncIntegration.svelte'
	import AppShell from './AppShell.svelte'
	import JazzStartup from './JazzStartup.svelte'
	import { getReadiness } from '#lib/bank-sync.js'

	let { children: pageContent }: { children: Snippet } = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const readiness = getReadiness()
	const applicationState = fromStore(readiness.snapshot)
	const workspaceState = $derived(applicationState.current.context.workspace?.getSnapshot())
	const ready = $derived(workspaceState?.hasTag('workspace-ready') ?? false)
	const setupError = $derived(workspaceState?.hasTag('workspace-error') ?? false)
	const db = getDb()
	const syncConfigured = Boolean(db.getConfig().serverUrl)
	let browserOffline = $state(false)

	// Browser connectivity is a hint, not confirmation of server delivery.
	onMount(() => {
		function updateConnectivity() {
			browserOffline = !navigator.onLine
		}
		updateConnectivity()
		window.addEventListener('online', updateConnectivity)
		window.addEventListener('offline', updateConnectivity)
		return () => {
			window.removeEventListener('online', updateConnectivity)
			window.removeEventListener('offline', updateConnectivity)
		}
	})

	const organizationQuery = new QuerySubscription(() =>
		ready ? app.organizations.orderBy('name') : undefined
	)
	const accountQuery = new QuerySubscription(() =>
		ready && filters.activeOrganizationId
			? app.accounts
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const organizations = $derived(organizationQuery.current ?? [])
	const activeAccounts = $derived(accountQuery.current ?? [])

	function setActiveOrganization(value: string | null) {
		filters.activeOrganizationId = value || null
		filters.selectedAccountIds = null
	}

	function setAccountSelected(accountId: string, checked: boolean) {
		if (checked && filters.selectedAccountIds === null) return

		const selected = new Set(
			filters.selectedAccountIds ?? activeAccounts.map((account) => account.id)
		)
		if (checked) selected.add(accountId)
		else selected.delete(accountId)
		filters.selectedAccountIds = [...selected]
	}

	function setAllAccountsSelected(checked: boolean) {
		filters.selectedAccountIds = checked ? null : []
	}
</script>

<BankSyncIntegration
	{browserOffline}
	organizations={organizationQuery.current}
	organizationsLoading={organizationQuery.isLoading}
	organizationsError={organizationQuery.error}
	onSelectOrganization={setActiveOrganization}
>
	{#snippet children(bankSync)}
		{#if ready}
			<AppShell
				{bankSync}
				{organizations}
				{syncConfigured}
				{browserOffline}
				accounts={activeAccounts}
				organizationId={filters.activeOrganizationId}
				selectedAccountIds={filters.selectedAccountIds}
				organizationQueries={[organizationQuery]}
				accountQueries={[organizationQuery, accountQuery]}
				onOrganizationChange={setActiveOrganization}
				onAccountChange={setAccountSelected}
				onAllAccountsChange={setAllAccountsSelected}>{@render pageContent()}</AppShell
			>
		{:else if setupError}
			<JazzStartup error workspace />
		{:else}
			<JazzStartup workspace />
		{/if}
	{/snippet}
</BankSyncIntegration>
