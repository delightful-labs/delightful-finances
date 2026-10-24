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

const checkValues = z.strictObject({
	checkNumber: checkNumberText,
	checkDate: dateOnlyText,
	payerName: z.string().optional(),
	bankName: z.string().optional(),
	memoOnCheck: z.string().optional()
})

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

const amountText = z
	.string()
	.transform((value, context) => {
		const parsed = parseAmountMinor(value)
		if (parsed.kind === 'valid') return parsed.amountMinor
		context.addIssue({ code: 'custom', message: 'Enter a valid amount.' })
		return z.NEVER
	})
	.pipe(amountMinorValue)

/** Form intent: a Check can be created inline or selected explicitly by identity. */
export const transactionSaveSchema = z.union([
	z.strictObject({
		...independentTransactionShape,
		paymentMethod: z.literal('check'),
		check: z.discriminatedUnion('kind', [
			z.strictObject({ kind: z.literal('new'), values: checkValues }),
			z.strictObject({
				kind: z.literal('existing'),
				id: z.uuid(),
				// Omission preserves Check metadata; supplied values are an explicit metadata edit.
				values: checkValues.optional()
			})
		])
	}),
	otherPayment.extend(independentTransactionShape)
])
export type TransactionSaveValues = z.output<typeof transactionSaveSchema>

export function independentTransactionFormSchema(
	getOptions: () => TransactionFormOptions & {
		transaction?:
			| (Pick<TransactionRow, 'source' | 'externalId'> & Partial<Pick<TransactionRow, 'checkId'>>)
			| null
	}
) {
	const fields = z.object({
		accountId: z.string(),
		categoryId: z.string().optional().default(''),
		bookedOn: dateOnlyText,
		amount: amountText,
		description: transactionBaseShape.description,
		memo: transactionBaseShape.memo,
		tags: tagNames,
		paymentMethod: z.enum(['', 'cash', 'check', 'transfer', 'electronic']).optional().default(''),
		checkId: z.string().optional(),
		checkNumber: z.string().optional(),
		checkDate: z.string().optional()
	})
	return fields
		.transform<unknown>((fields, context) => {
			const options = getOptions()
			const account = options.accounts.find((row) => row.id === fields.accountId)
			const category = options.categories.find(
				(row) => row.id === (fields.categoryId || defaultTransactionCategory(options)?.id)
			)
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
				organizationId: account.organizationId,
				accountId: account.id,
				categoryId: category.id,
				kind: options.kind,
				bookedOn: fields.bookedOn,
				money: { amountMinor: fields.amount, currency: account.currency },
				description: fields.description,
				memo: fields.memo,
				tags: fields.tags,
				source:
					options.transaction?.source === 'simplefin'
						? { source: 'simplefin', externalId: options.transaction.externalId }
						: { source: 'manual' }
			}
			if (fields.paymentMethod !== 'check')
				return { ...base, paymentMethod: fields.paymentMethod || null, checkId: null }
			const id =
				fields.checkId === undefined ? options.transaction?.checkId : fields.checkId || null
			const values =
				fields.checkNumber !== undefined || fields.checkDate !== undefined
					? { checkNumber: fields.checkNumber, checkDate: fields.checkDate }
					: undefined
			return {
				...base,
				paymentMethod: 'check',
				check: id
					? { kind: 'existing', id, ...(values ? { values } : {}) }
					: { kind: 'new', values }
			}
		})
		.pipe(transactionSaveSchema)
}

// Shared public form contract; both directions and provider sources use the same schema.
export const appTransactionSchema = transactionSaveSchema
export const transactionFormSchema = independentTransactionFormSchema
export function transactionSchemaFor(_transaction: z.input<typeof transactionSaveSchema>) {
	return _transaction.paymentMethod === 'check'
		? transactionSaveSchema.options[0]
		: transactionSaveSchema.options[1]
}
