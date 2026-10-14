import { getDb } from 'jazz-tools/svelte'
import type { z } from 'zod'
import { createAccount } from '#lib/data.js'
import type { Account } from '#lib/schema.js'
import type { FormSave } from '#lib/machines/form.js'
import type { accountFormSchema } from '#lib/validation/accounts.js'
import type { FinanceFilters } from '#lib/finance-filters.js'

export function createAccountFormState(filters: FinanceFilters) {
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
	return {
		save,
		get organizationId() {
			return filters.activeOrganizationId
		}
	}
}
