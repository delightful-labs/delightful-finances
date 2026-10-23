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

<svelte:head><title>{m['nouns.workspace']({ count: 2 })} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['nouns.workspace']({ count: 2 })} />
<QueryContent
	queries={[organizations]}
	loadingMessage={m['status.loading_subject']({ subject: m['nouns.workspace']({ count: 2 }) })}
	errorMessage={m['errors.load_subject']({ subject: m['nouns.workspace']({ count: 2 }) })}
>
	<WorkspaceSelector
		organizations={organizations.current ?? []}
		organizationId={filters.activeOrganizationId}
		label={m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}
		onchange={(workspaceId) => coordinator.actor?.send({ type: 'SELECT_WORKSPACE', workspaceId })}
	/>
</QueryContent>
{#if filters.activeOrganizationId}
	<Heading level="h2"
		>{m['labels.subject_settings']({ subject: m['nouns.workspace']({ count: 1 }) })}</Heading
	>
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
