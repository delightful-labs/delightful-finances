<script lang="ts">
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { createAccountListState } from '#lib/controllers/account-list.svelte.js'
	import { m } from '#lib/paraglide/messages.js'
	import AccountList from '#lib/components/AccountList.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const content = createAccountListState(filters)
</script>

<svelte:head><title>{m['labels.accounts']()} · {m['app.name']()}</title></svelte:head>
<PageHeader
	title={m['labels.accounts']()}
	action={{ href: '/accounts/new', label: m['actions.add_account']() }}
/>
<QueryContent
	queries={content.queries}
	loadingMessage={m['status.loading']({ subject: m['labels.accounts']() })}
	errorMessage={m['errors.load']({ subject: m['labels.accounts']() })}
>
	<AccountList
		accounts={content.accounts}
		archivableAccountIds={content.archivableAccountIds}
		archiving={content.archiving}
		archivingAccountId={content.archivingAccountId}
		archivedName={content.archivedName}
		archiveFailed={content.archiveFailed}
		onArchive={content.archive}
	/>
</QueryContent>
