import type { Account, Category, OrganizationMember } from './schema.js'
import type { AppTransaction } from './domain/transaction.js'
import type { ScopedFormView } from './form-contract.js'
export type TransactionEntryScope = {
	identityId: string | null
	organizationId: string | null
	binding: object | null
	kind: 'income' | 'expense'
}
export type TransactionEntryReason =
	| 'sessionUnavailable'
	| 'selectWorkspace'
	| 'loadFailed'
	| 'loading'
	| 'readOnly'
	| 'noAccounts'
	| 'noCategories'
	| 'unavailableReference'
export type TransactionEntryObservation = TransactionEntryScope & {
	sessionReady: boolean
	loading: boolean
	failed: boolean
	membership: OrganizationMember | null | undefined
	grants: readonly { accountId: string; access: 'read' | 'write' }[]
	accounts: readonly Account[]
	categories: readonly Category[]
	intent?: AppTransaction
}
export type TransactionEntryView = ScopedFormView<void, TransactionEntryReason>
