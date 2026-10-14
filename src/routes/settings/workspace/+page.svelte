<script lang="ts">
	import { createFormController } from '#lib/forms.svelte.js'
	import { workspaceNameFormSchema } from '#lib/validation/identity.js'
	import type { FormSave } from '#lib/machines/form.js'
	import { renameWorkspace } from '#lib/data.js'
	import { app, type Organization } from '#lib/schema.js'
	import type { z } from 'zod'
	import { getDb, getJazzSession, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'
	import WorkspaceNameForm from '#lib/components/WorkspaceNameForm.svelte'
	import Message from '#lib/components/Message.svelte'

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
		return organizationId && userId
			? app.organizationMembers.where({ organizationId, userId })
			: undefined
	})
	const workspace = $derived(workspaceQuery.current)
	const canRename = $derived(
		membershipQuery.current?.organizationId === filters.activeOrganizationId &&
			(membershipQuery.current?.role === 'owner' || membershipQuery.current?.role === 'admin')
	)
	const save: FormSave<
		z.output<typeof workspaceNameFormSchema>,
		void,
		Pick<Organization, 'id'>
	> = async (values, { context, signal }) => {
		signal.throwIfAborted()
		if (!canRename || context.id !== filters.activeOrganizationId || workspace?.id !== context.id)
			throw new Error('The workspace is not editable.')
		await renameWorkspace(db, context.id, values.name)
	}
	const form = createFormController({
		schema: workspaceNameFormSchema,
		save,
		context: () => ({ id: filters.activeOrganizationId ?? '' }),
		key: () => filters.activeOrganizationId,
		disabled: () => !workspace || !canRename
	})
</script>

<svelte:head><title>{m['workspace.label']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['workspace.label']()} />
<QueryContent
	queries={[workspaceQuery, membershipQuery]}
	loadingMessage={m['status.loading']({ subject: m['labels.workspace_settings']() })}
	errorMessage={m['errors.load']({ subject: m['labels.workspace_settings']() })}
>
	{#if workspace}
		<WorkspaceNameForm {workspace} {canRename} {form} />
	{:else}
		<Message message={m['workspace.select_workspace']()} />
	{/if}
</QueryContent>
