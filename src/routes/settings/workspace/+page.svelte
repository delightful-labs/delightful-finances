<script lang="ts">
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { createWorkspaceSettingsState } from '#lib/controllers/workspace-settings.svelte.js'
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'
	import WorkspaceNameForm from '#lib/components/WorkspaceNameForm.svelte'
	import Message from '#lib/components/Message.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const content = createWorkspaceSettingsState(filters)
</script>

<svelte:head><title>{m['workspace.label']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['workspace.label']()} />
<QueryContent
	queries={content.queries}
	loadingMessage={m['status.loading']({ subject: m['labels.workspace_settings']() })}
	errorMessage={m['errors.load']({ subject: m['labels.workspace_settings']() })}
>
	{#if content.workspace}
		<WorkspaceNameForm
			workspace={content.workspace}
			canRename={content.canRename}
			form={content.form}
		/>
	{:else}
		<Message message={m['workspace.select_workspace']()} />
	{/if}
</QueryContent>
