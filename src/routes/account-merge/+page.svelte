<script lang="ts">
	import { getContext } from 'svelte'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import AccountMergeIntegration from '#lib/components/AccountMergeIntegration.svelte'
	const db = getDb()
	const session = getJazzSession()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
</script>

<svelte:head><title>{m['account_merge.title']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['account_merge.title']()} />
<AccountMergeIntegration {db} {session} organizationId={filters.activeOrganizationId} />
