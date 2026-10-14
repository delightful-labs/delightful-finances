<script lang="ts">
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { createTransactionFormState } from '#lib/controllers/transaction-form.svelte.js'
	import { m } from '#lib/paraglide/messages.js'
	import TransactionForm from '#lib/components/TransactionForm.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'
	import Message from '#lib/components/Message.svelte'
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const content = createTransactionFormState(filters, 'expense')
</script>

<svelte:head><title>{m['actions.add_expense']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['actions.add_expense']()} />
<QueryContent
	queries={content.queries}
	loadingMessage={m['status.loading']({ subject: m['labels.accounts_and_categories']() })}
	errorMessage={m['errors.load']({ subject: m['labels.accounts_and_categories']() })}
>
	{#if content.accounts.length === 0}
		<Message message={m['transactions.no_accounts']()} />
	{:else}
		<TransactionForm
			kind="expense"
			organizationId={content.organizationId}
			accounts={content.accounts}
			categories={content.categories}
			defaultCategoryId={content.defaultCategoryId}
			tagSuggestions={content.tagSuggestions}
			form={content.form}
		/>
	{/if}
</QueryContent>
