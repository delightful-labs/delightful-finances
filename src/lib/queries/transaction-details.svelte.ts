import { QuerySubscriptionOne } from 'jazz-tools/svelte'
import { app } from '#lib/schema.js'
import type { FinanceFilters } from '#lib/finance-filters.js'

export function createTransactionDetailsState(
	getTransactionId: () => string,
	filters: FinanceFilters
) {
	const query = new QuerySubscriptionOne(() =>
		filters.activeOrganizationId
			? app.transactions
					.where({ id: getTransactionId(), organizationId: filters.activeOrganizationId })
					.select('*', '$createdBy', '$createdAt', '$updatedBy', '$updatedAt')
					.include({ account: true, category: true, tags: { tag: true }, checkDetails: true })
			: undefined
	)
	const transaction = $derived(query.current)
	const creator = new QuerySubscriptionOne(() =>
		transaction ? app.profiles.where({ userId: transaction.$createdBy.account }) : undefined
	)
	const editor = new QuerySubscriptionOne(() =>
		transaction ? app.profiles.where({ userId: transaction.$updatedBy.account }) : undefined
	)

	return {
		queries: [query],
		get transaction() {
			return transaction
		},
		get creatorName() {
			return creator.current?.displayName || transaction?.$createdBy.account
		},
		get editorName() {
			return editor.current?.displayName || transaction?.$updatedBy.account
		}
	}
}

export type TransactionDetail = NonNullable<
	ReturnType<typeof createTransactionDetailsState>['transaction']
>
