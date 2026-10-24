import {
	allOf,
	anyOf,
	type PermissionExpressionInput,
	type RowContext,
	type RowRefValue
} from 'jazz-tools/permissions'

type IdExpression = string | RowRefValue
type CheckLookup = { id: IdExpression; organizationId: IdExpression; accountId: IdExpression }
type TransactionReference = {
	id: string
	organizationId: string
	accountId: string
	checkId: string | null
	paymentMethod: 'cash' | 'check' | 'transfer' | 'electronic' | null
}

/**
 * Reference consistency only: callers must also enforce account authorization.
 * Apply on transaction insert and update. Multiple transactions may reference
 * the same Check; exclusive assignment is explicitly deferred.
 */
export function checkReferenceCondition({
	transaction,
	checkExists
}: {
	transaction: RowContext<TransactionReference>
	checkExists: (where: CheckLookup) => PermissionExpressionInput
}): PermissionExpressionInput {
	return anyOf([
		allOf([
			{ checkId: { isNull: true } },
			anyOf([
				{ paymentMethod: { isNull: true } },
				{ paymentMethod: 'cash' },
				{ paymentMethod: 'transfer' },
				{ paymentMethod: 'electronic' }
			])
		]),
		allOf([
			{ paymentMethod: 'check', checkId: { isNull: false } },
			checkExists({
				id: transaction.checkId,
				organizationId: transaction.organizationId,
				accountId: transaction.accountId
			})
		])
	])
}
