import { z } from 'zod'
import { appTagSchema } from './tags.js'
import { checkNumberText } from './checks.js'
import { parseAmountMinor } from '../domain/money.js'
import type { Account, Category, TransactionRow } from '../schema.js'

export { checkNumberText } from './checks.js'

export const amountMinorValue = z.number().int().nonnegative()
const supportedCurrencies = new Set(Intl.supportedValuesOf('currency'))
export const currencyText = z
	.string()
	.regex(/^[A-Z]{3}$/)
	.refine((currency) => supportedCurrencies.has(currency))
export const dateOnlyText = z.iso.date()
export const externalIdText = z.string().trim().min(1)

/** Direction-neutral persisted payment/check reference contract for independent checks. */
export const transactionPaymentSchema = z.union([
	z.strictObject({ paymentMethod: z.literal('check'), checkId: z.uuid() }),
	z.strictObject({
		paymentMethod: z.enum(['cash', 'transfer', 'electronic']).nullable().optional().default(null),
		checkId: z.null().optional().default(null)
	})
])

const tagNames = z
	.array(appTagSchema.shape.name)
	.transform((names) => {
		const unique = new Map(names.map((name) => [name.toLowerCase(), name]))
		return [...unique.values()]
	})
	.optional()

const transactionBaseShape = {
	tags: tagNames,
	accountId: z.string(),
	organizationId: z.string(),
	categoryId: z.string(),
	bookedOn: dateOnlyText,
	money: z.strictObject({ amountMinor: amountMinorValue, currency: currencyText }),
	description: z
		.string()
		.trim()
		.transform((value) => value || undefined)
		.optional(),
	memo: z
		.string()
		.trim()
		.transform((value) => value || undefined)
		.optional()
}

const transactionSourceSchema = z.discriminatedUnion('source', [
	z.strictObject({ source: z.literal('manual') }),
	z.strictObject({ source: z.literal('simplefin'), externalId: externalIdText })
])

/** Canonical values for the staged save path; direction and source share payment rules. */
const independentTransactionShape = {
	...transactionBaseShape,
	organizationId: z.uuid(),
	accountId: z.uuid(),
	categoryId: z.uuid(),
	kind: z.enum(['income', 'expense']),
	source: transactionSourceSchema
}
const [checkPayment, otherPayment] = transactionPaymentSchema.options
export const independentTransactionSchema = z.union([
	checkPayment.extend(independentTransactionShape),
	otherPayment.extend(independentTransactionShape)
])

const checkDetails = z.strictObject({
	checkNumber: checkNumberText,
	checkDate: dateOnlyText,
	payerName: z.string().optional(),
	bankName: z.string().optional(),
	memoOnCheck: z.string().optional()
})

const expenseTransaction = z.strictObject({
	...transactionBaseShape,
	kind: z.literal('expense'),
	source: transactionSourceSchema
})

const manualIncomeTransaction = z.strictObject({
	...transactionBaseShape,
	kind: z.literal('income'),
	source: z.strictObject({ source: z.literal('manual') }),
	paymentMethod: z.enum(['cash', 'transfer', 'electronic']).default('cash')
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

type TransactionFormOptions = {
	organizationId: string | null
	kind: TransactionRow['kind']
	accounts: readonly Account[]
	categories: readonly Category[]
	transaction?: Pick<TransactionRow, 'source' | 'externalId'> | null
}

export function defaultTransactionCategory(
	options: Pick<TransactionFormOptions, 'organizationId' | 'kind' | 'categories'>
) {
	return options.categories.find(
		(category) =>
			category.isSystem &&
			category.organizationId === options.organizationId &&
			category.kind === options.kind &&
			category.archivedAt === null
	)
}

const [expense, manualIncome, checkIncome] = appTransactionSchema.options
const amountText = z
	.string()
	.transform((value, context) => {
		const parsed = parseAmountMinor(value)
		if (parsed.kind === 'valid') return parsed.amountMinor
		context.addIssue({ code: 'custom', message: 'Enter a valid amount.' })
		return z.NEVER
	})
	.pipe(expense.shape.money.shape.amountMinor)
const paymentMethod = z.union([manualIncome.shape.paymentMethod, checkIncome.shape.paymentMethod])

export function transactionFormSchema(getOptions: () => TransactionFormOptions) {
	const categoryId = z.preprocess(
		(value) => (value === '' ? undefined : value),
		expense.shape.categoryId.default(() => defaultTransactionCategory(getOptions())?.id ?? '')
	)
	const fields = expense
		.pick({ accountId: true, categoryId: true, bookedOn: true, description: true, memo: true })
		.extend({ categoryId, amount: amountText, paymentMethod, tags: expense.shape.tags })
		// Preserve raw check fields until the canonical check-income branch validates them.
		.loose()

	return fields
		.transform<unknown>((fields, context) => {
			const options = getOptions()
			const account = options.accounts.find((row) => row.id === fields.accountId)
			const category = options.categories.find((row) => row.id === fields.categoryId)
			if (
				!account ||
				!category ||
				account.organizationId !== options.organizationId ||
				category.organizationId !== options.organizationId ||
				account.archivedAt !== null ||
				category.archivedAt !== null ||
				category.kind !== options.kind
			) {
				context.addIssue({ code: 'custom', message: 'Select an available account and category.' })
				return z.NEVER
			}
			const base = {
				accountId: account.id,
				organizationId: account.organizationId,
				categoryId: category.id,
				bookedOn: fields.bookedOn,
				money: { amountMinor: fields.amount, currency: account.currency },
				...(fields.description === undefined ? {} : { description: fields.description }),
				...(fields.memo === undefined ? {} : { memo: fields.memo }),
				source:
					options.transaction?.source === 'simplefin'
						? { source: 'simplefin', externalId: options.transaction.externalId }
						: { source: 'manual' },
				...(fields.tags === undefined ? {} : { tags: fields.tags })
			}
			if (options.kind === 'expense' || options.transaction?.source === 'simplefin')
				return { ...base, kind: options.kind }
			return fields.paymentMethod === 'check'
				? {
						...base,
						kind: options.kind,
						paymentMethod: fields.paymentMethod,
						checkDetails: {
							checkNumber: fields.checkNumber,
							checkDate: fields.checkDate
						}
					}
				: { ...base, kind: options.kind, paymentMethod: fields.paymentMethod }
		})
		.pipe(appTransactionSchema)
}
