<script lang="ts">
	import { accountFormSchema } from '#lib/validation/accounts.js'
	import { createFormController } from '#lib/forms.svelte.js'
	import type { FormSave } from '#lib/machines/form.js'
	import type { Account } from '#lib/schema.js'
	import { createAccount } from '#lib/data.js'
	import type { z } from 'zod'
	import { getDb } from 'jazz-tools/svelte'
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import AccountForm from '#lib/components/AccountForm.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)

	const db = getDb()
	const save: FormSave<
		z.output<typeof accountFormSchema>,
		Account,
		{ organizationId: string | null }
	> = async (values, { context, signal }) => {
		signal.throwIfAborted()
		if (!context.organizationId || context.organizationId !== filters.activeOrganizationId)
			throw new Error('No matching workspace is selected.')
		return createAccount(db, context.organizationId, values.name, values.kind)
	}
	const form = createFormController({
		schema: accountFormSchema,
		save,
		context: () => ({ organizationId: filters.activeOrganizationId }),
		key: () => filters.activeOrganizationId,
		disabled: () => !filters.activeOrganizationId
	})
</script>

<svelte:head><title>{m['actions.add_account']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['actions.add_account']()} />
<AccountForm organizationId={filters.activeOrganizationId} {form} />
