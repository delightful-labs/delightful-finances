<script lang="ts">
	import { orderAccounts } from '#lib/machines/account-order.js'
	import { createFormController } from '#lib/forms.svelte.js'
	import { app } from '#lib/schema.js'
	import {
		defaultTransactionCategory,
		transactionFormSchema
	} from '#lib/validation/transactions.js'
	import type { FormSave } from '#lib/machines/form.js'
	import type { AppTransaction } from '#lib/domain/transaction.js'
	import { createTransaction } from '#lib/data.js'
	import { getDb, QuerySubscription } from 'jazz-tools/svelte'
	import { getContext } from 'svelte'
	import {
		financeFiltersKey,
		accountOrderKey,
		type FinanceFilters,
		type AccountOrder
	} from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import AccountCreation from '#lib/components/AccountCreation.svelte'
	import TransactionForm from '#lib/components/TransactionForm.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'
	import Message from '#lib/components/Message.svelte'
	let { kind }: { kind: 'income' | 'expense' } = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const accountOrder = getContext<AccountOrder>(accountOrderKey)

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
	const accounts = $derived(orderAccounts(accountQuery.current ?? [], accountOrder.ids))
	const defaultAccountId = $derived(
		accounts.find(
			(account) =>
				filters.selectedAccountIds === null || filters.selectedAccountIds.includes(account.id)
		)?.id
	)
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
</script>

<svelte:head
	><title
		>{kind === 'income' ? m['actions.add_income']() : m['actions.add_expense']()} · {m[
			'app.name'
		]()}</title
	></svelte:head
>
<PageHeader title={kind === 'income' ? m['actions.add_income']() : m['actions.add_expense']()} />
<QueryContent
	queries={[accountQuery, categoryQuery, tagQuery]}
	loadingMessage={m['status.loading']({ subject: m['labels.accounts_and_categories']() })}
	errorMessage={m['errors.load']({ subject: m['labels.accounts_and_categories']() })}
>
	{#if accounts.length === 0}
		<Message message={m['transactions.no_accounts']()} />
		<AccountCreation />
	{:else}
		<TransactionForm
			{kind}
			organizationId={filters.activeOrganizationId}
			{accounts}
			{defaultAccountId}
			categories={availableCategories}
			defaultCategoryId={defaultCategory?.id}
			{tagSuggestions}
			{form}
		/>
	{/if}
</QueryContent>
