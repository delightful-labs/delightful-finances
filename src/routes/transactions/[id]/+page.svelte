<script lang="ts">
	import { getContext } from 'svelte'
	import { page } from '$app/state'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { createTransactionDetailsState } from '#lib/queries/transaction-details.svelte.js'
	import { m } from '#lib/paraglide/messages.js'
	import TransactionDetails from '#lib/components/TransactionDetails.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const content = createTransactionDetailsState(() => page.params.id ?? '', filters)
</script>

<svelte:head><title>{m['transactions.details']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['transactions.details']()} />
<QueryContent
	queries={content.queries}
	loadingMessage={m['status.loading']({ subject: m['labels.transaction']() })}
	errorMessage={m['errors.load']({ subject: m['labels.transaction']() })}
>
	<TransactionDetails
		transaction={content.transaction}
		creatorName={content.creatorName}
		editorName={content.editorName}
	/>
</QueryContent>
