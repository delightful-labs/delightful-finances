<script lang="ts">
	import { getContext } from 'svelte'
	import { createTagSettingsState } from '#lib/controllers/tag-settings.svelte.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import TagForm from '#lib/components/TagForm.svelte'
	import TagList from '#lib/components/TagList.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const content = createTagSettingsState(filters)
</script>

<svelte:head>
	<title>{m['labels.tags']()} · {m['app.name']()}</title>
</svelte:head>

<PageHeader title={m['labels.tags']()} />
<QueryContent
	queries={content.queries}
	loadingMessage={m['status.loading']({ subject: m['labels.tags']() })}
	errorMessage={m['errors.load']({ subject: m['labels.tags']() })}
>
	{#if content.organizationId && content.hasMembership}
		<TagList
			tags={content.tags}
			categoryNames={content.categoryNames}
			canArchive={content.canCreate}
			archiving={content.archiving}
			archivingTagId={content.archivingTagId}
			archivedName={content.archivedName}
			archiveFailed={content.archiveFailed}
			onArchive={content.archive}
		/>
		<TagForm
			organizationId={content.organizationId}
			canCreate={content.canCreate}
			categories={content.availableCategories}
			form={content.form}
		/>
	{/if}
</QueryContent>
