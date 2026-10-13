<script lang="ts">
	import { getContext } from 'svelte'
	import { getJazzSession, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { app } from '#lib/schema.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import WorkspaceNameForm from './WorkspaceNameForm.svelte'
	import QueryContent from './QueryContent.svelte'

	const session = getJazzSession()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const workspaceQuery = new QuerySubscriptionOne(() =>
		filters.activeOrganizationId
			? app.organizations.where({ id: filters.activeOrganizationId })
			: undefined
	)
	const membershipQuery = new QuerySubscriptionOne(() => {
		const userId = $session.account?.id
		const organizationId = filters.activeOrganizationId
		return organizationId && userId
			? app.organizationMembers.where({ organizationId, userId })
			: undefined
	})
	const workspace = $derived(workspaceQuery.current)
	const canRename = $derived(
		membershipQuery.current?.role === 'owner' || membershipQuery.current?.role === 'admin'
	)
</script>

<h1>{m['workspace.label']()}</h1>
<QueryContent
	queries={[workspaceQuery, membershipQuery]}
	loadingMessage={m['status.loading']({ subject: m['labels.workspace_settings']() })}
	errorMessage={m['errors.load']({ subject: m['labels.workspace_settings']() })}
>
	{#if workspace}
		<WorkspaceNameForm {workspace} {canRename} />
	{:else}
		<p>{m['workspace.select_workspace']()}</p>
	{/if}
</QueryContent>
