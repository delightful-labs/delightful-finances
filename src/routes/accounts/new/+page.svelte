<script lang="ts">
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { createAccountFormState } from '#lib/controllers/account-form.svelte.js'
	import { m } from '#lib/paraglide/messages.js'
	import AccountForm from '#lib/components/AccountForm.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const content = createAccountFormState(filters)
</script>

<svelte:head><title>{m['actions.add_account']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['actions.add_account']()} />
<AccountForm organizationId={content.organizationId} form={content.form} />
