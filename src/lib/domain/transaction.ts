import type { z } from 'zod'
import type { TransactionRow } from '../schema.js'
import { appTransactionSchema, transactionSchemaFor } from '../validation/transaction-input.js'

export type IncomePaymentMethod = NonNullable<TransactionRow['paymentMethod']>

export type AppTransaction = z.output<typeof appTransactionSchema>
export type TransactionValidationError =
	| 'amount'
	| 'currency'
	| 'booked-on'
	| 'check-number'
	| 'check-date'
	| 'source-id'
	| 'invalid-transaction'

const validationErrorByPath: Readonly<Record<string, TransactionValidationError>> = {
	'money.amountMinor': 'amount',
	'money.currency': 'currency',
	bookedOn: 'booked-on',
	'checkDetails.checkNumber': 'check-number',
	'checkDetails.checkDate': 'check-date',
	'source.externalId': 'source-id'
}

export function validateTransaction(
	transaction: AppTransaction
): TransactionValidationError | null {
	if (appTransactionSchema.safeParse(transaction).success) return null
	const result = transactionSchemaFor(transaction).safeParse(transaction)
	if (result.success) return null

	const path = result.error.issues[0]?.path.join('.')
	return (path && validationErrorByPath[path]) || 'invalid-transaction'
}
