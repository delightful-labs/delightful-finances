<script lang="ts">
	import { createFormController } from '#lib/forms.svelte.js'
	import type { FormSave } from '#lib/machines/form.js'
	import { categoryArchiveSchema, categoryFormSchema } from '#lib/validation/categories.js'
	import { archiveCategory, createCategory } from '#lib/data.js'
	import { app, type Category } from '#lib/schema.js'
	import type { z } from 'zod'
	import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import { canEditCategoriesAndTags } from '#lib/domain/organization-permissions.js'
	import CategoryForm from '#lib/components/CategoryForm.svelte'
	import CategoryList from '#lib/components/CategoryList.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)

	const db = getDb()
	const session = fromStore(getJazzSession())
	const categories = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	// Count all readable history, regardless of sidebar account selection or tag archive state.
	const transactions = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.transactions.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const tags = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.tags.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const membership = new QuerySubscriptionOne(() => {
		const organizationId = filters.activeOrganizationId
		const userId = session.current.account?.id
		return organizationId && userId
			? app.organizationMembers.where({ organizationId, userId })
			: undefined
	})
	const counts = $derived.by(() => {
		const result = new Map<string, { transactions: number; tags: number }>()
		for (const category of categories.current ?? [])
			result.set(category.id, { transactions: 0, tags: 0 })
		for (const transaction of transactions.current ?? []) {
			const count = result.get(transaction.categoryId)
			if (count) count.transactions += 1
		}
		for (const tag of tags.current ?? []) {
			const count = tag.categoryId ? result.get(tag.categoryId) : undefined
			if (count) count.tags += 1
		}
		return result
	})
	const canCreate = $derived(
		canEditCategoriesAndTags(membership.current, filters.activeOrganizationId)
	)
	const canArchive = $derived.by(
		() => (category: Category) =>
			canEditCategoriesAndTags(membership.current, filters.activeOrganizationId) &&
			!category.isSystem
	)
	const save: FormSave<
		z.output<typeof categoryFormSchema>,
		Category,
		{ organizationId: string | null }
	> = async (values, { context, signal }) => {
		signal.throwIfAborted()
		if (
			!canCreate ||
			!context.organizationId ||
			context.organizationId !== filters.activeOrganizationId
		)
			throw new Error('The workspace is not editable.')
		return createCategory(db, context.organizationId, values.name, values.kind)
	}
	const form = createFormController({
		schema: categoryFormSchema,
		save,
		context: () => ({ organizationId: filters.activeOrganizationId }),
		key: () => filters.activeOrganizationId,
		disabled: () => !canCreate
	})
	const archive = createFormController({
		schema: categoryArchiveSchema,
		save: async (values, { signal }) => {
			signal.throwIfAborted()
			const category = categories.current?.find((row) => row.id === values.categoryId)
			if (
				values.organizationId !== filters.activeOrganizationId ||
				!category ||
				!canArchive(category)
			)
				throw new Error('The category is not editable in the active workspace.')
			await archiveCategory(db, category.id)
			return category.name
		},
		context: () => undefined,
		key: () => filters.activeOrganizationId,
		disabled: () => !canCreate
	})
	const archivableCategoryIds = $derived(
		(categories.current ?? []).filter(canArchive).map((category) => category.id)
	)
	const archiveState = $derived(archive.view.state)
	const archivedName = $derived(
		archiveState.matches('success') ? archiveState.context.result : undefined
	)
	const archiveFailed = $derived(archiveState.matches('error') || archiveState.matches('invalid'))
	const archivingCategoryId = $derived(archiveState.context.validated?.value.categoryId)
	function onArchive(categoryId: string) {
		archive.submitValues({ categoryId, organizationId: filters.activeOrganizationId })
	}
</script>

<svelte:head><title>{m['labels.categories']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['labels.categories']()} />
<QueryContent
	queries={[categories, transactions, tags, membership]}
	loadingMessage={m['status.loading']({ subject: m['labels.categories']() })}
	errorMessage={m['errors.load']({ subject: m['labels.categories']() })}
>
	{#if filters.activeOrganizationId && membership.current}
		<CategoryList
			categories={categories.current ?? []}
			{counts}
			{archivableCategoryIds}
			archiving={archive.view.busy}
			{archivingCategoryId}
			{archivedName}
			{archiveFailed}
			{onArchive}
		/>
		<CategoryForm organizationId={filters.activeOrganizationId} {canCreate} {form} />
	{/if}
</QueryContent>
