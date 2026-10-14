import { fromStore } from 'svelte/store'
import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
import type { z } from 'zod'
import { app, type Category } from '#lib/schema.js'
import { archiveCategory, createCategory } from '#lib/data.js'
import { categoryArchiveSchema, categoryFormSchema } from '#lib/validation/categories.js'
import type { FormSave } from '#lib/machines/form.js'
import type { FinanceFilters } from '#lib/finance-filters.js'
import { createFormController } from './form.svelte.js'

export function createCategorySettingsState(filters: FinanceFilters) {
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
	function canArchive(category: Category) {
		const member = membership.current
		return (
			!category.isSystem &&
			member?.organizationId === filters.activeOrganizationId &&
			(member.role === 'owner' || member.role === 'admin' || member.role === 'member')
		)
	}

	const canCreate = $derived(
		membership.current?.organizationId === filters.activeOrganizationId &&
			(membership.current?.role === 'owner' ||
				membership.current?.role === 'admin' ||
				membership.current?.role === 'member')
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
	return {
		queries: [categories, transactions, tags, membership],
		form,
		archive(categoryId: string) {
			archive.submitValues({ categoryId, organizationId: filters.activeOrganizationId })
		},
		get organizationId() {
			return filters.activeOrganizationId
		},
		get hasMembership() {
			return Boolean(membership.current)
		},
		get canCreate() {
			return canCreate
		},
		get categories() {
			return categories.current ?? []
		},
		get counts() {
			return counts
		},
		get archivableCategoryIds() {
			return archivableCategoryIds
		},
		get archiving() {
			return archive.view.busy
		},
		get archivingCategoryId() {
			return archive.view.state.context.validated?.value.categoryId
		},
		get archivedName() {
			return archive.view.state.matches('success') ? archive.view.state.context.result : undefined
		},
		get archiveFailed() {
			return archive.view.state.matches('error') || archive.view.state.matches('invalid')
		}
	}
}
