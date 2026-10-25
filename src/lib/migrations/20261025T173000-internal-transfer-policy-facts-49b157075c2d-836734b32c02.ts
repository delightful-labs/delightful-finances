import { schema as s } from 'jazz-tools'

export default s.defineMigration({
	migrate: {
		internalTransfers: {
			expenseAccountId: s.add.ref('accounts', { default: null }),
			incomeAccountId: s.add.ref('accounts', { default: null }),
			amountMinor: s.add.bigint({ default: null }),
			currency: s.add.string({ default: null })
		}
	},
	fromHash: '49b157075c2d',
	toHash: '836734b32c02',
	from: {
		internalTransfers: s.table(
			{
				organizationId: s.uuid(),
				expenseTransactionId: s.uuid(),
				incomeTransactionId: s.uuid()
			},
			{
				organization: s.rel('organizations', 'organizationId'),
				expenseTransaction: s.rel('transactions', 'expenseTransactionId'),
				incomeTransaction: s.rel('transactions', 'incomeTransactionId')
			}
		)
	},
	to: {
		internalTransfers: s.table(
			{
				organizationId: s.uuid(),
				expenseTransactionId: s.uuid(),
				incomeTransactionId: s.uuid(),
				expenseAccountId: s.uuid().optional(),
				incomeAccountId: s.uuid().optional(),
				amountMinor: s.bigint().optional(),
				currency: s.string().optional()
			},
			{
				organization: s.rel('organizations', 'organizationId'),
				expenseTransaction: s.rel('transactions', 'expenseTransactionId'),
				incomeTransaction: s.rel('transactions', 'incomeTransactionId'),
				expenseAccount: s.rel('accounts', 'expenseAccountId'),
				incomeAccount: s.rel('accounts', 'incomeAccountId')
			}
		)
	}
})
