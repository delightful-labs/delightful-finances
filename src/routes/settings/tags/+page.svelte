<script lang="ts">
	import { createFormController } from '#lib/forms.svelte.js'
	import { tagArchiveSchema, tagFormSchema } from '#lib/validation/tags.js'
	import type { FormSave } from '#lib/machines/form.js'
	import { archiveTag, createTag } from '#lib/data.js'
	import { app, type Tag } from '#lib/schema.js'
	import type { z } from 'zod'
	import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import TagForm from '#lib/components/TagForm.svelte'
	import TagList from '#lib/components/TagList.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)

	const db = getDb()
	const tags = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.tags
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	// Archived categories retain their labels in tag history.
	const categories = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const categoryNames = $derived(
		new Map((categories.current ?? []).map((category) => [category.id, category.name]))
	)
	const session = fromStore(getJazzSession())
	const membership = new QuerySubscriptionOne(() => {
		const userId = session.current.account?.id
		const organizationId = filters.activeOrganizationId
		return organizationId && userId
			? app.organizationMembers.where({ organizationId, userId })
			: undefined
	})
	const canCreate = $derived(
		membership.current?.organizationId === filters.activeOrganizationId &&
			(membership.current?.role === 'owner' ||
				membership.current?.role === 'admin' ||
				membership.current?.role === 'member')
	)
	const availableCategories = $derived(
		(categories.current ?? [])
			.filter(
				(category) =>
					category.organizationId === filters.activeOrganizationId && !category.archivedAt
			)
			.toSorted((left, right) => left.name.localeCompare(right.name))
	)
	const schema = tagFormSchema.refine(
		(values) =>
			values.categoryId === null ||
			availableCategories.some((category) => category.id === values.categoryId),
		{ path: ['categoryId'], message: 'Select an available category.' }
	)
	const save: FormSave<
		z.output<typeof tagFormSchema>,
		Tag,
		{ organizationId: string | null }
	> = async (values, { context, signal }) => {
		signal.throwIfAborted()
		if (
			!canCreate ||
			!context.organizationId ||
			context.organizationId !== filters.activeOrganizationId
		)
			throw new Error('The workspace is not editable.')
		return createTag(db, context.organizationId, values.name, values.categoryId)
	}
	const form = createFormController({
		schema,
		save,
		context: () => ({ organizationId: filters.activeOrganizationId }),
		key: () => filters.activeOrganizationId,
		disabled: () => !canCreate
	})
	const archive = createFormController({
		schema: tagArchiveSchema,
		save: async (values, { signal }) => {
			signal.throwIfAborted()
			const tag = tags.current?.find((row) => row.id === values.tagId)
			if (values.organizationId !== filters.activeOrganizationId || !tag || !canCreate)
				throw new Error('The tag is not editable in the active workspace.')
			await archiveTag(db, tag.id)
			return tag.name
		},
		context: () => undefined,
		key: () => filters.activeOrganizationId,
		disabled: () => !canCreate
	})
	function onArchive(tagId: string) {
		archive.submitValues({ tagId, organizationId: filters.activeOrganizationId })
	}
</script>

<svelte:head>
	<title>{m['labels.tags']()} · {m['app.name']()}</title>
</svelte:head>

<PageHeader title={m['labels.tags']()} />
<QueryContent
	queries={[membership, tags, categories]}
	loadingMessage={m['status.loading']({ subject: m['labels.tags']() })}
	errorMessage={m['errors.load']({ subject: m['labels.tags']() })}
>
	{#if filters.activeOrganizationId && Boolean(membership.current)}
		<TagList
			tags={tags.current ?? []}
			{categoryNames}
			canArchive={canCreate}
			archiving={archive.view.busy}
			archivingTagId={archive.view.state.context.validated?.value.tagId}
			archivedName={archive.view.state.matches('success')
				? archive.view.state.context.result
				: undefined}
			archiveFailed={archive.view.state.matches('error') || archive.view.state.matches('invalid')}
			{onArchive}
		/>
		<TagForm
			organizationId={filters.activeOrganizationId}
			{canCreate}
			categories={availableCategories}
			{form}
		/>
	{/if}
</QueryContent>
