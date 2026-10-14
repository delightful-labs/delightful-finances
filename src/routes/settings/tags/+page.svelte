<script lang="ts">
	import { getContext } from 'svelte'
	import { createTagSettingsState } from '#lib/controllers/tag-settings.svelte.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import TagForm from '#lib/components/TagForm.svelte'
	import TagList from '#lib/components/TagList.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const content = createTagSettingsState(filters)
</script>

<svelte:head>
	<title>{m['labels.tags']()} · {m['app.name']()}</title>
</svelte:head>

<QueryContent
	queries={content.queries}
	loadingMessage={m['status.loading']({ subject: m['workspace.label']() })}
	errorMessage={m['errors.load']({ subject: m['workspace.label']() })}
>
	{#if content.organizationId && content.hasMembership}
		{#key content.organizationId}
			<TagList />
		{/key}
		<TagForm organizationId={content.organizationId} canCreate={content.canCreate} />
	{/if}
</QueryContent>
