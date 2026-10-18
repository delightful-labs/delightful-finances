<script lang="ts">
	import { observeRow } from '#lib/observations.js'
	import { createScopedFormController } from '#lib/forms.svelte.js'
	import { createWorkspaceRenameFormOptions } from '#lib/machines/workspace-rename.js'
	import type {
		WorkspaceRenameObservation,
		WorkspaceRenameReason,
		WorkspaceRenameScope
	} from '#lib/workspace-rename-contract.js'
	import type { SnapshotFrom } from 'xstate'
	import { renameWorkspace } from '#lib/data.js'
	import { app } from '#lib/schema.js'
	import { getDb, getJazzSession, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import WorkspaceNameForm from '#lib/components/WorkspaceNameForm.svelte'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'

	const filters = getContext<FinanceFilters>(financeFiltersKey)

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
	const form = createScopedFormController<
		{ name: string },
		void,
		WorkspaceRenameReason,
		WorkspaceRenameScope,
		WorkspaceRenameObservation,
		SnapshotFrom<typeof options.availability>,
		SnapshotFrom<typeof options.operation>
	>(options)
</script>

<svelte:head><title>{m['workspace.label']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['workspace.label']()} />
<WorkspaceNameForm
	name={workspace?.name ?? ''}
	view={form.view}
	onsubmit={form.submit}
	onreset={form.reset}
	oninput={form.input}
	onRetryReadiness={form.retryReadiness}
/>
