<script lang="ts">
	import { app } from '#lib/schema.js'
	import { QuerySubscription } from 'jazz-tools/svelte'
	import { ensurePersonalWorkspace } from '#lib/data.js'
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
	let ready = $state(false)
	let setupError = $state(false)
	let attempt = 0
	$effect(() => {
		if (session.current.status !== 'ready' || !session.current.account) {
			attempt += 1
			ready = false
			setupError = false
			return
		}
		const currentAttempt = ++attempt
		const userId = session.current.account.id
		ready = false
		setupError = false
		void ensurePersonalWorkspace(db, userId)
			.then(() => {
				if (currentAttempt === attempt) ready = true
			})
			.catch(() => {
				if (currentAttempt === attempt) setupError = true
			})
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
