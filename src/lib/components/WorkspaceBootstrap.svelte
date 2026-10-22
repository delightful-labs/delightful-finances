<script lang="ts">
	import { app } from '#lib/schema.js'
	import { QuerySubscription } from 'jazz-tools/svelte'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { getContext, setContext, onMount, untrack, type Snippet } from 'svelte'
	import {
		financeFiltersKey,
		accountOrderKey,
		type FinanceFilters,
		type AccountOrder
	} from '#lib/finance-filters.js'
	import BankSyncIntegration from './BankSyncIntegration.svelte'
	import AppShell from './AppShell.svelte'
	import AccountCreation from './AccountCreation.svelte'
	import JazzStartup from './JazzStartup.svelte'
	import { useMachine } from '@xstate/svelte'
	import { accountOrderMachine, orderAccounts } from '#lib/machines/account-order.js'
	import { getReadiness } from '#lib/bank-sync.js'

	let { children: pageContent }: { children: Snippet } = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const readiness = getReadiness()
	const applicationState = fromStore(readiness.snapshot)
	const workspaceState = $derived(applicationState.current.context.workspace?.getSnapshot())
	const ready = $derived(workspaceState?.hasTag('workspace-ready') ?? false)
	const setupError = $derived(workspaceState?.hasTag('workspace-error') ?? false)
	const retryableSetup = $derived(workspaceState?.hasTag('workspace-retryable') ?? false)
	function retrySetup() {
		readiness.actor.getSnapshot().context.workspace?.send({ type: 'RETRY' })
	}
	const db = getDb()
	const session = fromStore(getJazzSession())
	const accountOrder = useMachine(accountOrderMachine)
	const orderSnapshot = accountOrder.snapshot
	let movedOrder = $state<{ key: string; ids: readonly string[] } | undefined>()
	const orderKey = $derived(
		`finance-account-order:${session.current.account?.id ?? ''}:${filters.activeOrganizationId ?? ''}`
	)
	const preferredOrder = $derived.by((): readonly string[] => {
		if (movedOrder?.key === orderKey) return movedOrder.ids
		try {
			const stored: unknown = JSON.parse(localStorage.getItem(orderKey) ?? '[]')
			if (Array.isArray(stored) && stored.every((id): id is string => typeof id === 'string'))
				return stored
		} catch {
			// An unavailable browser store leaves ordering usable for this session.
		}
		return []
	})
	// Consumers read the same preference before choosing their initial form values.
	setContext<AccountOrder>(accountOrderKey, {
		get ids() {
			return preferredOrder
		}
	})
	$effect(() => {
		void orderKey
		untrack(() =>
			accountOrder.send({
				type: 'RESET',
				ids: activeAccounts.map((account) => account.id)
			})
		)
	})
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
	const activeAccounts = $derived(orderAccounts(accountQuery.current ?? [], preferredOrder))
	$effect(() => {
		const ids = activeAccounts.map((account) => account.id)
		untrack(() => accountOrder.send({ type: 'OBSERVE', ids }))
	})

	function moveAccount(id: string, direction: 'up' | 'down') {
		const event = { type: 'MOVE', id, direction } satisfies Parameters<typeof accountOrder.send>[0]
		if (!accountOrder.actorRef.getSnapshot().can(event)) return
		accountOrder.send(event)
		movedOrder = { key: orderKey, ids: accountOrder.actorRef.getSnapshot().context.ids }
		try {
			localStorage.setItem(orderKey, JSON.stringify(preferredOrder))
		} catch {
			// Keep the current session's order when storage is unavailable.
		}
	}

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
				editingAccountOrder={$orderSnapshot.matches('editing')}
				canToggleAccountOrder={$orderSnapshot.can({ type: 'EDIT' }) ||
					$orderSnapshot.can({ type: 'DONE' })}
				canMoveAccount={(id, direction) => $orderSnapshot.can({ type: 'MOVE', id, direction })}
				onEditAccountOrder={() => accountOrder.send({ type: 'EDIT' })}
				onDoneAccountOrder={() => accountOrder.send({ type: 'DONE' })}
				onMoveAccount={moveAccount}
				organizationId={filters.activeOrganizationId}
				selectedAccountIds={filters.selectedAccountIds}
				organizationQueries={[organizationQuery]}
				accountQueries={[organizationQuery, accountQuery]}
				onOrganizationChange={setActiveOrganization}
				onAccountChange={setAccountSelected}
				onAllAccountsChange={setAllAccountsSelected}
			>
				{#snippet accountCreation(trigger)}
					<AccountCreation {trigger} />
				{/snippet}
				{@render pageContent()}
			</AppShell>
		{:else if setupError}
			<JazzStartup error workspace {...retryableSetup ? { onRetry: retrySetup } : {}} />
		{:else}
			<JazzStartup workspace />
		{/if}
	{/snippet}
</BankSyncIntegration>
