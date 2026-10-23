<script lang="ts">
	import { app } from '#lib/schema.js'
	import { QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { goto } from '$app/navigation'
	import { page } from '$app/state'
	import {
		selectWorkspaceView,
		type WorkspaceCoordinatorSnapshot,
		type WorkspaceAttachment,
		type ReadinessObservation
	} from '#lib/machines/readiness.js'
	import { selectAttachedWorkspace } from '#lib/machines/application-readiness.js'
	import { workspaceKey, type WorkspaceContext } from '#lib/workspace.js'
	import { observeRow, observeRows } from '#lib/observations.js'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import WorkspaceIntegrityNotice from './WorkspaceIntegrityNotice.svelte'
	import { m } from '#lib/paraglide/messages.js'
	import WorkspaceScopeNotice from './WorkspaceScopeNotice.svelte'
	import { getContext, setContext, onMount, onDestroy, untrack, type Snippet } from 'svelte'
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
	let workspaceState = $state.raw<WorkspaceCoordinatorSnapshot | undefined>()
	const workspaceView = $derived(selectWorkspaceView(workspaceState))
	const ready = $derived(workspaceView.ready)
	const showPageContent = $derived(
		['scoped', 'directory', 'global'].includes(workspaceView.navigation)
	)
	const setupError = $derived(workspaceView.failed)
	const retryableSetup = $derived(workspaceView.canRetry)
	function retrySetup() {
		workspaceActor?.send({ type: 'RETRY' })
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
	const userId = $derived(session.current.account?.id)
	const organizationId = $derived(filters.activeOrganizationId)
	const membershipQuery = new QuerySubscriptionOne(() =>
		organizationMembershipQuery(organizationId, userId)
	)
	const connectionQuery = new QuerySubscription(() =>
		ready && organizationId && userId
			? app.simplefinConnections.where({ organizationId, ownerId: userId })
			: undefined
	)
	const linkQuery = new QuerySubscription(() =>
		ready && organizationId ? app.simplefinAccountLinks.where({ organizationId }) : undefined
	)
	function readSource() {
		return {
			organizationId,
			userId,
			sessionReady: session.current.status === 'ready',
			membership: observeRow(membershipQuery.current),
			connections: observeRows(connectionQuery.current),
			accounts: observeRows(accountQuery.current),
			links: observeRows(linkQuery.current)
		}
	}
	function readReadiness(): ReadinessObservation {
		return {
			source: readSource(),
			sessionStatus: session.current.status,
			membershipLoading: membershipQuery.isLoading,
			membershipError: membershipQuery.error,
			organizations: organizationQuery.current,
			organizationsLoading: organizationQuery.isLoading,
			organizationsError: organizationQuery.error,
			route: {
				pathname: page.url.pathname,
				search: page.url.search,
				hash: page.url.hash
			}
		}
	}
	const attachment: WorkspaceAttachment = {
		environment: JSON.stringify([db.getConfig().appId, db.getConfig().serverUrl ?? '']),
		dependencies: { db, read: readSource, passkeyName: () => m['app.name']() },
		read: readReadiness,
		navigate: (destination, signal, expectedHref, replace) => {
			signal.throwIfAborted()
			if (`${page.url.pathname}${page.url.search}${page.url.hash}` !== expectedHref)
				return Promise.resolve()
			return goto(destination, { replace })
		}
	}
	readiness.actor.send({ type: 'ATTACH_WORKSPACE', attachment })
	const workspaceActor = $derived(selectAttachedWorkspace(applicationState.current, attachment))
	setContext<WorkspaceContext>(workspaceKey, {
		get actor() {
			return workspaceActor
		},
		get view() {
			return workspaceView
		}
	})
	$effect(() => {
		const actor = workspaceActor
		workspaceState = actor?.getSnapshot()
		if (!actor) return
		const subscription = actor.subscribe((snapshot) => {
			workspaceState = snapshot
		})
		return () => subscription.unsubscribe()
	})
	$effect(() => {
		const observation = readReadiness()
		const actor = workspaceActor
		untrack(() => actor?.send({ type: 'OBSERVED', observation }))
	})
	onDestroy(() => readiness.actor.send({ type: 'DETACH_WORKSPACE', attachment }))

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
		if (value) workspaceActor?.send({ type: 'SELECT_WORKSPACE', workspaceId: value })
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

{#if workspaceActor}
	{#key workspaceActor}
		<WorkspaceIntegrityNotice
			view={workspaceView.integrity}
			onRetry={() => workspaceActor?.send({ type: 'RETRY_INTEGRITY' })}
		/>
		<BankSyncIntegration
			{browserOffline}
			queries={[membershipQuery, connectionQuery, accountQuery, linkQuery]}
			{userId}
			{organizationId}
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
						{#if showPageContent}
							{#key `${session.current.account?.id}:${filters.activeOrganizationId}`}{@render pageContent()}{/key}
						{/if}
						<WorkspaceScopeNotice
							active={!showPageContent}
							failed={workspaceView.navigation === 'failed'}
							loading={workspaceView.navigation === 'waiting'}
							onRetry={() => workspaceActor?.send({ type: 'RETRY_NAVIGATION' })}
						/>
					</AppShell>
				{:else if setupError}
					<JazzStartup error workspace {...retryableSetup ? { onRetry: retrySetup } : {}} />
				{:else}
					<JazzStartup workspace />
				{/if}
			{/snippet}
		</BankSyncIntegration>
	{/key}
{:else}
	<JazzStartup workspace />
{/if}
