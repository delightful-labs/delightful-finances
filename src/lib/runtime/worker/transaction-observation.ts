import type { TransactionEntryObservation } from '../../contracts/transaction-entry-contract.js'
import type { TransactionEditRoute } from '../../contracts/transaction-route-contract.js'
import type { TransactionDetail } from '../../schema.js'

/** An absent edit identity selects the creation policy. Explicit null belongs
 * to an unresolved edit and must never be synthesized for a creation form. */
export function selectedTransactionFacts(
	route: TransactionEditRoute | null,
	kind: TransactionEntryObservation['kind'],
	organizationId: string | null,
	transaction: TransactionDetail | null | undefined
): Pick<TransactionEntryObservation, 'transactionId' | 'transaction'> {
	if (!route || route.kind !== kind) return {}
	return {
		transactionId: route.transactionId,
		transaction:
			transaction?.id === route.transactionId &&
			transaction.organizationId === organizationId &&
			transaction.kind === kind
				? transaction
				: null
	}
}
