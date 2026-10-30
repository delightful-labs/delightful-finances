import { schema as s } from 'jazz-tools'

import { accountsSchema } from './schema/accounts.js'
import { attachmentsSchema } from './schema/attachments.js'
import { batchesSchema } from './schema/batches.js'
import { categoriesSchema } from './schema/categories.js'
import { checksSchema } from './schema/checks.js'
import { identitySchema } from './schema/identity.js'
import { integrationsSchema } from './schema/integrations.js'
import { tagsSchema } from './schema/tags.js'
import { transactionsSchema } from './schema/transactions.js'

const schema = {
	...identitySchema,
	...accountsSchema,
	...categoriesSchema,
	...tagsSchema,
	...transactionsSchema,
	...checksSchema,
	...integrationsSchema,
	...attachmentsSchema,
	...batchesSchema
}

export const app = s.defineApp(schema)

export type Organization = s.RowOf<typeof app.organizations>
export type OrganizationMember = s.RowOf<typeof app.organizationMembers>
export type AccountMembership = s.RowOf<typeof app.accountMemberships>
export type Account = s.RowOf<typeof app.accounts>
export type Category = s.RowOf<typeof app.categories>
export type Tag = s.RowOf<typeof app.tags>
export type TransactionRow = s.RowOf<typeof app.transactions>
export type InternalTransfer = s.RowOf<typeof app.internalTransfers>
export type Check = s.RowOf<typeof app.checks>

export const transactionSummaryQuery = app.transactions.select(
	'id',
	'accountId',
	'categoryId',
	'amountMinor',
	'currency',
	'kind'
)

export const transactionDetailQuery = app.transactions
	.select('*', '$createdBy', '$createdAt', '$updatedBy', '$updatedAt')
	.include({
		account: true,
		category: true,
		tags: { tag: true },
		check: true,
		attachments: { file: { parts: true } }
	})
export type TransactionDetail = s.RowOf<typeof transactionDetailQuery>
