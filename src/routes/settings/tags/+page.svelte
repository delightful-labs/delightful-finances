<script lang="ts">
	import { getContext } from 'svelte'
	import { getJazzSession, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { app } from '#lib/schema.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import TagForm from '#lib/components/TagForm.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'

	const session = getJazzSession()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const membershipQuery = new QuerySubscriptionOne(() => {
		const userId = $session.account?.id
		const organizationId = filters.activeOrganizationId
		return organizationId && userId
			? app.organizationMembers.where({ organizationId, userId })
			: undefined
	})
	const canCreate = $derived(
		membershipQuery.current?.role === 'owner' ||
			membershipQuery.current?.role === 'admin' ||
			membershipQuery.current?.role === 'member'
	)
</script>

<svelte:head>
	<title>{m['labels.tags']()} · {m['app.name']()}</title>
</svelte:head>

<QueryContent
	queries={[membershipQuery]}
	loadingMessage={m['status.loading']({ subject: m['workspace.label']() })}
	errorMessage={m['errors.load']({ subject: m['workspace.label']() })}
>
	{#if filters.activeOrganizationId && membershipQuery.current}
		<TagForm organizationId={filters.activeOrganizationId} {canCreate} />
	{/if}
</QueryContent>
