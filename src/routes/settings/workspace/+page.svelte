<script lang="ts">
	import { observeRow } from '#lib/observations.js'
	import { createScopedFormController } from '#lib/forms.svelte.js'
	import { createWorkspaceRenameFormOptions } from '#lib/machines/workspace-rename.js'
	import type { WorkspaceRenameObservation } from '#lib/workspace-rename-contract.js'
	import { renameWorkspace } from '#lib/data.js'
	import { app } from '#lib/schema.js'
	import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import { Heading } from 'delightful-ui'
	import WorkspaceSelector from '#lib/components/WorkspaceSelector.svelte'
	import { getWorkspace } from '#lib/workspace.js'
	import QueryContent from '#lib/components/QueryContent.svelte'
	import WorkspaceCreation from '#lib/components/WorkspaceCreation.svelte'
	import WorkspaceNameForm from '#lib/components/WorkspaceNameForm.svelte'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const coordinator = getWorkspace()

	const organizations = new QuerySubscription(() => app.organizations.orderBy('name'))
	const db = getDb()
	const session = fromStore(getJazzSession())
	const workspaceQuery = new QuerySubscriptionOne(() =>
		filters.activeOrganizationId
			? app.organizations.where({ id: filters.activeOrganizationId })
			: undefined
	)
	const membershipQuery = new QuerySubscriptionOne(() => {
		const userId = session.current.account?.id
		const organizationId = filters.activeOrganizationId
		return organizationMembershipQuery(organizationId, userId)
	})
	const workspace = $derived(workspaceQuery.current)
	function observe(): WorkspaceRenameObservation {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready',
			workspaceLoading: workspaceQuery.isLoading,
			membershipLoading: membershipQuery.isLoading,
			workspaceError: workspaceQuery.error != null,
			membershipError: membershipQuery.error != null,
			workspace: observeRow(workspaceQuery.current),
			membership: observeRow(membershipQuery.current)
		}
	}
	const options = createWorkspaceRenameFormOptions({
		binding: db,
		observe,
		rename: (id, name) => renameWorkspace(db, id, name)
	})
	const form = createScopedFormController(options)
</script>

<svelte:head><title>{m['labels.workspaces']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['labels.workspaces']()} />
<QueryContent
	queries={[organizations]}
	loadingMessage={m['status.loading']({ subject: m['labels.workspaces']() })}
	errorMessage={m['errors.load']({ subject: m['labels.workspaces']() })}
>
	<WorkspaceSelector
		organizations={organizations.current ?? []}
		organizationId={filters.activeOrganizationId}
		label={m['workspace.choose']()}
		onchange={(workspaceId) => coordinator.actor?.send({ type: 'SELECT_WORKSPACE', workspaceId })}
	/>
</QueryContent>
{#if filters.activeOrganizationId}
	<Heading level="h2">{m['labels.workspace_settings']()}</Heading>
	<WorkspaceNameForm
		name={workspace?.name ?? ''}
		view={form.view}
		onsubmit={form.submit}
		onreset={form.reset}
		oninput={form.input}
		onRetryReadiness={form.retryReadiness}
	/>
{/if}
<WorkspaceCreation />
