import { schema as s } from 'jazz-tools'
import {
	amountMinorValue,
	checkNumberText,
	currencyText,
	dateOnlyText,
	externalIdText
} from '../validation/transactions.js'
import { validatedTextColumn } from './text-column.js'
import { transactionCheckColumns, transactionCheckRelations } from './checks.js'

const currencyColumn = validatedTextColumn(currencyText)
const bookedOnColumn = validatedTextColumn(dateOnlyText)
const checkDateColumn = validatedTextColumn(dateOnlyText)
const checkNumberColumn = validatedTextColumn(checkNumberText)
const externalIdColumn = validatedTextColumn(externalIdText)

export const transactionsSchema = {
	transactions: s.table(
		{
			amountMinor: s.bigint().transform<number>({
				from: (value) => amountMinorValue.parse(Number(value)),
				to: (value) => BigInt(amountMinorValue.parse(value))
			}),
			kind: s.enum('expense', 'income'),
			currency: currencyColumn.column,
			categoryId: s.uuid(),
			accountId: s.uuid(),
			organizationId: s.uuid(),
			// ISO 8601 calendar date (YYYY-MM-DD), not a timestamp.
			bookedOn: bookedOnColumn.column,
			description: s.string().optional(),
			memo: s.string().optional(),
			paymentMethod: s.enum('cash', 'check', 'transfer', 'electronic').optional(),
			checkDetailsId: s.uuid().optional(),
			...transactionCheckColumns,
			source: s.enum('manual', 'simplefin'),
			externalId: externalIdColumn.column.optional(),
			batchId: s.uuid().optional()
		},
		{
			account: s.rel('accounts', 'accountId'),
			category: s.rel('categories', 'categoryId'),
			organization: s.rel('organizations', 'organizationId'),
			batch: s.rel('transactionBatches', 'batchId'),
			tags: s.reverse('transactionTags', 'transaction'),
			checkDetails: s.rel('checkDetails', 'checkDetailsId'),
			...transactionCheckRelations,
			attachments: s.reverse('transactionAttachments', 'transaction')
		}
	),
	transactionTags: s.table(
		{
			organizationId: s.uuid(),
			transactionId: s.uuid(),
			tagId: s.uuid()
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			transaction: s.rel('transactions', 'transactionId'),
			tag: s.rel('tags', 'tagId')
		}
	),
	checkDetails: s.table(
		{
			transactionId: s.uuid(),
			organizationId: s.uuid(),
			accountId: s.uuid(),
			checkNumber: checkNumberColumn.column,
			checkDate: checkDateColumn.column,
			payerName: s.string().optional(),
			bankName: s.string().optional(),
			memoOnCheck: s.string().optional()
		},
		{
			transaction: s.rel('transactions', 'transactionId'),
			organization: s.rel('organizations', 'organizationId'),
			account: s.rel('accounts', 'accountId')
		}
	)
}
