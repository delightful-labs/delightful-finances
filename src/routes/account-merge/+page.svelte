<script lang="ts">
	import { getContext, onDestroy } from 'svelte'
	import { fromStore, readable } from 'svelte/store'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import { createActor } from 'xstate'
	import type {
		MergeDestination,
		MergeDestinationResult
	} from '#lib/schema/account-merge-destination.js'
	import { beforeNavigate } from '$app/navigation'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import {
		createAccountMergePresentationMachine,
		selectAccountMergePresentation
	} from '#lib/machines/account-merge/presentation.js'
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import AccountMerge from '#lib/components/AccountMerge.svelte'
	import AccountMergeDestinationIntegration from '#lib/components/AccountMergeDestinationIntegration.svelte'

	const db = getDb()
	const session = getJazzSession()
	const current = fromStore(session)
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const actor = createActor(createAccountMergePresentationMachine(db)).start()
	const presentationState = fromStore(
		readable(actor.getSnapshot(), (set) => {
			const subscription = actor.subscribe(set)
			return () => subscription.unsubscribe()
		})
	)
	let integration = $state<ReturnType<typeof AccountMergeDestinationIntegration>>()
	const view = $derived(selectAccountMergePresentation(presentationState.current))
	$effect(() => {
		actor.send({
			type: 'OBSERVED',
			observation: {
				status: current.current.status,
				identityId: current.current.account?.id ?? null,
				organizationId: filters.activeOrganizationId,
				binding: current.current.client?.db ?? null
			}
		})
	})
	function cancel() {
		actor.send({ type: 'CANCEL' })
		if (integration?.actor.getSnapshot().status === 'active')
			integration.actor.send({ type: 'CANCEL' })
	}
	function deliver(request: MergeDestination, result: MergeDestinationResult) {
		if (actor.getSnapshot().status === 'active') actor.send({ type: 'RESULT', request, result })
	}
	beforeNavigate(cancel)
	onDestroy(() => {
		actor.send({ type: 'SHUTDOWN' })
		if (integration?.actor.getSnapshot().status === 'active')
			integration.actor.send({ type: 'SHUTDOWN' })
		actor.stop()
	})
</script>

<svelte:head><title>{m['account_merge.title']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['account_merge.title']()} />
<AccountMerge {view} onCheck={() => actor.send({ type: 'CHECK' })} onCancel={cancel} />
{#if view.kind === 'checking'}
	{@const request = view.request}
	{#key request}
		<AccountMergeDestinationIntegration
			bind:this={integration}
			{db}
			{session}
			destination={request}
			organizationId={filters.activeOrganizationId}
			onResult={(result) => deliver(request, result)}
		/>
	{/key}
{/if}
