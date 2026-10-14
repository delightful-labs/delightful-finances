import { fromStore } from 'svelte/store'
import { getJazzSession, QuerySubscriptionOne } from 'jazz-tools/svelte'
import { app } from '#lib/schema.js'
import type { FinanceFilters } from '#lib/finance-filters.js'

export function createTagSettingsState(filters: FinanceFilters) {
	const session = fromStore(getJazzSession())
	const membership = new QuerySubscriptionOne(() => {
		const userId = session.current.account?.id
		const organizationId = filters.activeOrganizationId
		return organizationId && userId
			? app.organizationMembers.where({ organizationId, userId })
			: undefined
	})
	const canCreate = $derived(
		membership.current?.organizationId === filters.activeOrganizationId &&
			(membership.current?.role === 'owner' ||
				membership.current?.role === 'admin' ||
				membership.current?.role === 'member')
	)
	return {
		queries: [membership],
		get organizationId() {
			return filters.activeOrganizationId
		},
		get hasMembership() {
			return Boolean(membership.current)
		},
		get canCreate() {
			return canCreate
		}
	}
}
