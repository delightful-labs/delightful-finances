<script lang="ts">
	import { useMachine } from '@xstate/svelte'
	import { createWorkspaceBootstrapMachine } from '#lib/machines/workspace-bootstrap.js'
	import { app } from '#lib/schema.js'
	import { QuerySubscription } from 'jazz-tools/svelte'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { getContext, type Snippet } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import AppShell from './AppShell.svelte'
	import JazzStartup from './JazzStartup.svelte'

	let { children }: { children: Snippet } = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const session = fromStore(getJazzSession())
	const db = getDb()
	const { snapshot, send } = useMachine(createWorkspaceBootstrapMachine(db))
	const workspaceState = fromStore(snapshot)
	const ready = $derived(workspaceState.current.matches('ready'))
	const setupError = $derived(workspaceState.current.matches('error'))
	let previousUserId: string | null = null
	let sessionWasReady = false

	$effect(() => {
		const account = session.current.account
		const userId = session.current.status === 'ready' && account ? account.id : null
		if (userId === previousUserId && (userId !== null || !sessionWasReady)) return

		previousUserId = userId
		sessionWasReady = userId !== null
		if (userId) send({ type: 'SESSION_READY', userId })
		else send({ type: 'SESSION_UNAVAILABLE' })
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

	$effect(() => {
		if (
			!ready ||
			organizationQuery.isLoading ||
			organizationQuery.error ||
			!organizationQuery.current
		)
			return
		if (organizations.some((organization) => organization.id === filters.activeOrganizationId))
			return
		filters.activeOrganizationId =
			organizations.find((organization) => organization.kind === 'personal')?.id ??
			organizations[0]?.id ??
			null
		filters.selectedAccountIds = null
	})

	function setActiveOrganization(value: string) {
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

{#if ready}
	<AppShell
		{organizations}
		accounts={activeAccounts}
		organizationId={filters.activeOrganizationId}
		selectedAccountIds={filters.selectedAccountIds}
		organizationQueries={[organizationQuery]}
		accountQueries={[organizationQuery, accountQuery]}
		onOrganizationChange={setActiveOrganization}
		onAccountChange={setAccountSelected}
		onAllAccountsChange={setAllAccountsSelected}>{@render children()}</AppShell
	>
{:else if setupError}
	<JazzStartup error workspace />
{:else}
	<JazzStartup workspace />
{/if}
