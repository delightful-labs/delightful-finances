import { z } from 'zod'
import { parseAmountMinor } from '../domain/money.js'
import type { Account, Category, TransactionRow } from '../schema.js'
import { appTransactionSchema } from './transaction-input.js'

type TransactionFormOptions = {
	organizationId: string | null
	kind: TransactionRow['kind']
	accounts: readonly Account[]
	categories: readonly Category[]
}

const amountText = z.string().transform((value, context) => {
	const parsed = parseAmountMinor(value)
	if (parsed.kind === 'valid') return parsed.amountMinor
	context.addIssue({ code: 'custom', message: 'Enter a valid amount.' })
	return z.NEVER
})

export function transactionFormSchema(getOptions: () => TransactionFormOptions) {
	return z
		.object({
			accountId: z.string(),
			categoryId: z.string(),
			amount: amountText,
			bookedOn: z.string(),
			memo: z.string().trim().optional(),
			paymentMethod: z.enum(['cash', 'check', 'transfer', 'electronic']).optional(),
			checkNumber: z.string().optional(),
			checkDate: z.string().optional()
		})
		.transform<z.input<typeof appTransactionSchema>>((fields, context) => {
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
				...(fields.memo ? { memo: fields.memo } : {}),
				source: { source: 'manual' } satisfies z.input<typeof appTransactionSchema>['source']
			}
			if (options.kind === 'expense') return { ...base, kind: options.kind }
			const paymentMethod = fields.paymentMethod ?? 'cash'
			return paymentMethod === 'check'
				? {
						...base,
						kind: options.kind,
						paymentMethod,
						checkDetails: {
							checkNumber: fields.checkNumber ?? '',
							...(fields.checkDate ? { checkDate: fields.checkDate } : {})
						}
					}
				: { ...base, kind: options.kind, paymentMethod }
		})
		.pipe(appTransactionSchema)
}
