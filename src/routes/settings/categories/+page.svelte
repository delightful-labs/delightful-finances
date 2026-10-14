<script lang="ts">
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { createCategorySettingsState } from '#lib/controllers/category-settings.svelte.js'
	import { m } from '#lib/paraglide/messages.js'
	import CategoryForm from '#lib/components/CategoryForm.svelte'
	import CategoryList from '#lib/components/CategoryList.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const content = createCategorySettingsState(filters)
</script>

<svelte:head><title>{m['labels.categories']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['labels.categories']()} />
<QueryContent
	queries={content.queries}
	loadingMessage={m['status.loading']({ subject: m['labels.categories']() })}
	errorMessage={m['errors.load']({ subject: m['labels.categories']() })}
>
	{#if content.organizationId && content.hasMembership}
		<CategoryList
			categories={content.categories}
			counts={content.counts}
			archivableCategoryIds={content.archivableCategoryIds}
			archiving={content.archiving}
			archivingCategoryId={content.archivingCategoryId}
			archivedName={content.archivedName}
			archiveFailed={content.archiveFailed}
			onArchive={content.archive}
		/>
		<CategoryForm
			organizationId={content.organizationId}
			canCreate={content.canCreate}
			form={content.form}
		/>
	{/if}
</QueryContent>
