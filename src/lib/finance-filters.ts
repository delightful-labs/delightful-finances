export type FinanceFilters = {
	activeOrganizationId: string | null
	selectedAccountIds: string[] | null
}

export const financeFiltersKey = Symbol('finance-filters')

export type AccountOrder = { readonly ids: readonly string[] }

export const accountOrderKey = Symbol('account-order')
