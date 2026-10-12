import { schema as s } from 'jazz-tools'

import { accountsSchema } from './schema/accounts.js'
import { attachmentsSchema } from './schema/attachments.js'
import { batchesSchema } from './schema/batches.js'
import { categoriesSchema } from './schema/categories.js'
import { identitySchema } from './schema/identity.js'
import { integrationsSchema } from './schema/integrations.js'
import { transactionsSchema } from './schema/transactions.js'

const schema = {
	...identitySchema,
	...accountsSchema,
	...categoriesSchema,
	...transactionsSchema,
	...integrationsSchema,
	...attachmentsSchema,
	...batchesSchema
}

export const app = s.defineApp(schema)

export type Organization = s.RowOf<typeof app.organizations>
export type OrganizationMember = s.RowOf<typeof app.organizationMembers>
export type Account = s.RowOf<typeof app.accounts>
export type Category = s.RowOf<typeof app.categories>
export type TransactionRow = s.RowOf<typeof app.transactions>
