import { fromStore } from 'svelte/store'
import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
import type { z } from 'zod'
import { app, type Tag } from '#lib/schema.js'
import { archiveTag, createTag } from '#lib/data.js'
import type { FormSave } from '#lib/machines/form.js'
import { tagArchiveSchema, tagFormSchema } from '#lib/validation/tags.js'
import { createFormController } from './form.svelte.js'
import type { FinanceFilters } from '#lib/finance-filters.js'

export function createTagSettingsState(filters: FinanceFilters) {
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
	return {
		queries: [membership, tags, categories],
		form,
		get availableCategories() {
			return availableCategories
		},
		archive(tagId: string) {
			archive.submitValues({ tagId, organizationId: filters.activeOrganizationId })
		},
		get tags() {
			return tags.current ?? []
		},
		get categoryNames() {
			return categoryNames
		},
		get archiving() {
			return archive.view.busy
		},
		get archivingTagId() {
			return archive.view.state.context.validated?.value.tagId
		},
		get archivedName() {
			return archive.view.state.matches('success') ? archive.view.state.context.result : undefined
		},
		get archiveFailed() {
			return archive.view.state.matches('error') || archive.view.state.matches('invalid')
		},
		get organizationId() {
			return filters.activeOrganizationId
		},
		get hasMembership() {
			return Boolean(membership.current)
		},
		get canCreate() {
			return canCreate
		}
	}
}
