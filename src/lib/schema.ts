import { schema as s } from 'jazz-tools'

import { mergeOriginsSchema } from './schema/account-merge-origins.js'
import { accountsSchema } from './schema/accounts.js'
import { attachmentsSchema } from './schema/attachments.js'
import { batchesSchema } from './schema/batches.js'
import { categoriesSchema } from './schema/categories.js'
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
	...integrationsSchema,
	...attachmentsSchema,
	...batchesSchema,
	...mergeOriginsSchema
}

export const app = s.defineApp(schema)

export type Organization = s.RowOf<typeof app.organizations>
export type OrganizationMember = s.RowOf<typeof app.organizationMembers>
export type Account = s.RowOf<typeof app.accounts>
export type Category = s.RowOf<typeof app.categories>
export type Tag = s.RowOf<typeof app.tags>
export type MergeOrigin = s.RowOf<typeof app.mergeOrigins>
export type TransactionRow = s.RowOf<typeof app.transactions>

export const transactionDetailQuery = app.transactions
	.select('*', '$createdBy', '$createdAt', '$updatedBy', '$updatedAt')
	.include({ account: true, category: true, tags: { tag: true }, checkDetails: true })
export type TransactionDetail = s.RowOf<typeof transactionDetailQuery>
