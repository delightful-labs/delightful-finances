import { getDb, QuerySubscription } from 'jazz-tools/svelte'
import { createTransaction } from '#lib/data.js'
import type { AppTransaction } from '#lib/domain/transaction.js'
import type { FormSave } from '#lib/machines/form.js'
import { defaultTransactionCategory, transactionFormSchema } from '#lib/validation/transactions.js'
import { app } from '#lib/schema.js'
import type { FinanceFilters } from '#lib/finance-filters.js'
import { createFormController } from './form.svelte.js'

export function createTransactionFormState(filters: FinanceFilters, kind: 'expense' | 'income') {
	const db = getDb()
	const tagQuery = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.tags
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const tagSuggestions = $derived((tagQuery.current ?? []).map((tag) => tag.name))
	const accountQuery = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const categoryQuery = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories
					.where({
						organizationId: filters.activeOrganizationId,
						kind,
						archivedAt: { isNull: true }
					})
					.orderBy('name')
			: undefined
	)
	const accounts = $derived(accountQuery.current ?? [])
	const availableCategories = $derived(categoryQuery.current ?? [])
	const defaultCategory = $derived(
		defaultTransactionCategory({
			organizationId: filters.activeOrganizationId,
			kind,
			categories: availableCategories
		})
	)

	const schema = transactionFormSchema(() => ({
		organizationId: filters.activeOrganizationId,
		kind,
		accounts,
		categories: availableCategories
	}))
	const save: FormSave<
		AppTransaction,
		void,
		{ organizationId: string | null; kind: typeof kind }
	> = async (transaction, { context, signal }) => {
		signal.throwIfAborted()
		if (
			transaction.organizationId !== context.organizationId ||
			transaction.kind !== context.kind ||
			context.organizationId !== filters.activeOrganizationId
		)
			throw new Error('The transaction workspace changed before saving.')
		const result = await createTransaction(db, transaction)
		if ('error' in result) throw new Error(result.error)
	}
	const form = createFormController({
		schema,
		save,
		context: () => ({ organizationId: filters.activeOrganizationId, kind }),
		key: () => `${filters.activeOrganizationId}:${kind}`,
		disabled: () => accounts.length === 0 || availableCategories.length === 0,
		arrayFields: () => ['tags']
	})
	return {
		queries: [accountQuery, categoryQuery, tagQuery],
		form,
		get organizationId() {
			return filters.activeOrganizationId
		},
		get accounts() {
			return accounts
		},
		get categories() {
			return availableCategories
		},
		get defaultCategoryId() {
			return defaultCategory?.id
		},
		get tagSuggestions() {
			return tagSuggestions
		}
	}
}
