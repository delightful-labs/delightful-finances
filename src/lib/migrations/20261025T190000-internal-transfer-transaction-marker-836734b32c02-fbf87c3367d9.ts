import { schema as s } from 'jazz-tools'

export default s.defineMigration({
	migrate: {
		transactions: {
			internalTransferId: s.add.ref('internalTransfers', { default: null })
		}
	},
	fromHash: '836734b32c02',
	toHash: 'fbf87c3367d9',
	from: {
		transactions: s.table(
			{
				amountMinor: s.bigint(),
				kind: s.enum('expense', 'income'),
				currency: s.string(),
				categoryId: s.uuid(),
				accountId: s.uuid(),
				organizationId: s.uuid(),
				bookedOn: s.string(),
				description: s.string().optional(),
				memo: s.string().optional(),
				paymentMethod: s.enum('cash', 'check', 'transfer', 'electronic').optional(),
				checkDetailsId: s.uuid().optional(),
				checkId: s.uuid().optional(),
				source: s.enum('manual', 'simplefin'),
				externalId: s.string().optional(),
				batchId: s.uuid().optional()
			},
			{
				account: s.rel('accounts', 'accountId'),
				category: s.rel('categories', 'categoryId'),
				organization: s.rel('organizations', 'organizationId'),
				batch: s.rel('transactionBatches', 'batchId'),
				tags: s.reverse('transactionTags', 'transaction'),
				checkDetails: s.rel('checkDetails', 'checkDetailsId'),
				check: s.rel('checks', 'checkId'),
				attachments: s.reverse('transactionAttachments', 'transaction')
			}
		)
	},
	to: {
		transactions: s.table(
			{
				amountMinor: s.bigint(),
				kind: s.enum('expense', 'income'),
				currency: s.string(),
				categoryId: s.uuid(),
				accountId: s.uuid(),
				organizationId: s.uuid(),
				bookedOn: s.string(),
				description: s.string().optional(),
				memo: s.string().optional(),
				paymentMethod: s.enum('cash', 'check', 'transfer', 'electronic').optional(),
				checkDetailsId: s.uuid().optional(),
				checkId: s.uuid().optional(),
				internalTransferId: s.uuid().optional(),
				source: s.enum('manual', 'simplefin'),
				externalId: s.string().optional(),
				batchId: s.uuid().optional()
			},
			{
				account: s.rel('accounts', 'accountId'),
				category: s.rel('categories', 'categoryId'),
				organization: s.rel('organizations', 'organizationId'),
				batch: s.rel('transactionBatches', 'batchId'),
				tags: s.reverse('transactionTags', 'transaction'),
				checkDetails: s.rel('checkDetails', 'checkDetailsId'),
				check: s.rel('checks', 'checkId'),
				internalTransfer: s.rel('internalTransfers', 'internalTransferId'),
				attachments: s.reverse('transactionAttachments', 'transaction')
			}
		)
	}
})
