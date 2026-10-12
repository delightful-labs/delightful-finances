export type FinanceFilters = {
	activeOrganizationId: string | null
	selectedAccountIds: string[] | null
}

export const financeFiltersKey = Symbol('finance-filters')
