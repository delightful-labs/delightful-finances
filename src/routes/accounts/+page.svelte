<script lang="ts">
	import { actorInspection } from '#lib/actor-inspection.js'
	import { observeRow, observeRows } from '#lib/observations.js'
	import {
		createAccountArchiveMachine,
		selectAccountArchiveView
	} from '#lib/machines/account-archive.js'
	import { createActor } from 'xstate'
	import { archiveAccount } from '#lib/data.js'
	import { app } from '#lib/schema.js'
	import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { getContext, onMount } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import AccountCreation from '#lib/components/AccountCreation.svelte'
	import AccountList from '#lib/components/AccountList.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)

	const db = getDb()
	const session = fromStore(getJazzSession())
	const accounts = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const membership = new QuerySubscriptionOne(() => {
		const organizationId = filters.activeOrganizationId
		const userId = session.current.account?.id
		return organizationMembershipQuery(organizationId, userId)
	})
	const grants = new QuerySubscription(() => {
		const organizationId = filters.activeOrganizationId
		const userId = session.current.account?.id
		return organizationId && userId
			? app.accountMemberships.where({ organizationId, userId })
			: undefined
	})
	function observe() {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready' && session.current.client?.db === db,
			loading: accounts.isLoading || membership.isLoading || grants.isLoading,
			failed: accounts.error != null || membership.error != null || grants.error != null,
			accounts: observeRows(accounts.current),
			membership: observeRow(membership.current),
			grants: observeRows(grants.current)
		}
	}
	const actor = createActor(
		createAccountArchiveMachine((request) => archiveAccount(db, request.accountId), observe),
		actorInspection()
	)
	let archiveSnapshot = $state.raw(actor.getSnapshot())
	const view = $derived(selectAccountArchiveView(archiveSnapshot))
	$effect(() => actor.send({ type: 'OBSERVE', observation: observe() }))
	onMount(() => {
		const subscription = actor.subscribe((snapshot) => {
			archiveSnapshot = snapshot
		})
		actor.start()
		return () => {
			subscription.unsubscribe()
			// The owner must outlive the view while an issued local write settles.
			const completion = actor.subscribe({ complete: () => actor.stop() })
			actor.send({ type: 'SHUTDOWN' })
			if (actor.getSnapshot().status === 'done') {
				completion.unsubscribe()
				actor.stop()
			}
		}
	})
	function onArchive(accountId: string) {
		// Refresh observations before accepting a request, including changes before effects run.
		actor.send({ type: 'OBSERVE', observation: observe() })
		actor.send({ type: 'ARCHIVE', accountId })
	}
</script>

<svelte:head><title>{m['labels.accounts']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['labels.accounts']()} />
<AccountCreation />
<AccountList {view} {onArchive} />
