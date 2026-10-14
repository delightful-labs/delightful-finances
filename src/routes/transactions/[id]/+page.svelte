<script lang="ts">
	import { app, transactionDetailQuery } from '#lib/schema.js'
	import { QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { getContext } from 'svelte'
	import { page } from '$app/state'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import TransactionDetails from '#lib/components/TransactionDetails.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)

	const query = new QuerySubscriptionOne(() =>
		filters.activeOrganizationId
			? transactionDetailQuery.where({
					id: page.params.id ?? '',
					organizationId: filters.activeOrganizationId
				})
			: undefined
	)
	const transaction = $derived(query.current)
	const creator = new QuerySubscriptionOne(() =>
		transaction ? app.profiles.where({ userId: transaction.$createdBy.account }) : undefined
	)
	const editor = new QuerySubscriptionOne(() =>
		transaction ? app.profiles.where({ userId: transaction.$updatedBy.account }) : undefined
	)
</script>

<svelte:head><title>{m['transactions.details']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['transactions.details']()} />
<QueryContent
	queries={[query]}
	loadingMessage={m['status.loading']({ subject: m['labels.transaction']() })}
	errorMessage={m['errors.load']({ subject: m['labels.transaction']() })}
>
	<TransactionDetails
		{transaction}
		creatorName={creator.current?.displayName || transaction?.$createdBy.account}
		editorName={editor.current?.displayName || transaction?.$updatedBy.account}
	/>
</QueryContent>
