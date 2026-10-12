import { schema as s } from 'jazz-tools'
import { currencyText } from '../validation/transaction-input.js'
import { validatedTextColumn } from './text-column.js'

const currencyColumn = validatedTextColumn(currencyText)

export const accountsSchema = {
	accounts: s.table(
		{
			organizationId: s.uuid(),
			name: s.string(),
			kind: s.enum('cash', 'bank', 'card'),
			currency: currencyColumn.column,
			archivedAt: s.timestamp().optional()
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			transactions: s.reverse('transactions', 'account'),
			memberships: s.reverse('accountMemberships', 'account')
		}
	),
	accountMemberships: s.table(
		{
			organizationId: s.uuid(),
			userId: s.uuid(),
			accountId: s.uuid(),
			access: s.enum('read', 'write')
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			account: s.rel('accounts', 'accountId')
		}
	)
}
