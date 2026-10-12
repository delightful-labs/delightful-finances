import { z } from 'zod'

export const amountMinorValue = z.number().int().nonnegative()
const supportedCurrencies = new Set(Intl.supportedValuesOf('currency'))
export const currencyText = z
	.string()
	.regex(/^[A-Z]{3}$/)
	.refine((currency) => supportedCurrencies.has(currency))
export const dateOnlyText = z.iso.date()
export const checkNumberText = z.string().trim().min(1)
export const externalIdText = z.string().trim().min(1)

const transactionBaseShape = {
	accountId: z.string(),
	organizationId: z.string(),
	categoryId: z.string(),
	bookedOn: dateOnlyText,
	money: z.strictObject({ amountMinor: amountMinorValue, currency: currencyText }),
	memo: z.string().optional()
}

const checkDetails = z.strictObject({
	checkNumber: checkNumberText,
	checkDate: dateOnlyText.optional(),
	payerName: z.string().optional(),
	bankName: z.string().optional(),
	memoOnCheck: z.string().optional()
})

const expenseTransaction = z.strictObject({
	...transactionBaseShape,
	kind: z.literal('expense'),
	source: z.discriminatedUnion('source', [
		z.strictObject({ source: z.literal('manual') }),
		z.strictObject({ source: z.literal('simplefin'), externalId: externalIdText })
	])
})

const manualIncomeTransaction = z.strictObject({
	...transactionBaseShape,
	kind: z.literal('income'),
	source: z.strictObject({ source: z.literal('manual') }),
	paymentMethod: z.enum(['cash', 'transfer', 'electronic'])
})

const checkIncomeTransaction = z.strictObject({
	...transactionBaseShape,
	kind: z.literal('income'),
	source: z.strictObject({ source: z.literal('manual') }),
	paymentMethod: z.literal('check'),
	checkDetails
})

const importedIncomeTransaction = z.strictObject({
	...transactionBaseShape,
	kind: z.literal('income'),
	source: z.strictObject({ source: z.literal('simplefin'), externalId: externalIdText })
})

export const appTransactionSchema = z.union([
	expenseTransaction,
	manualIncomeTransaction,
	checkIncomeTransaction,
	importedIncomeTransaction
])

export function transactionSchemaFor(transaction: z.input<typeof appTransactionSchema>) {
	if (transaction.kind === 'expense') return expenseTransaction
	if (transaction.kind === 'income' && transaction.source.source === 'simplefin') {
		return importedIncomeTransaction
	}
	if ('paymentMethod' in transaction && transaction.paymentMethod === 'check') {
		return checkIncomeTransaction
	}
	return manualIncomeTransaction
}
