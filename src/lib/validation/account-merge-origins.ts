import { z } from 'zod'

export const mergeEntitySchema = z.enum([
	'accounts',
	'categories',
	'tags',
	'transactions',
	'checkDetails',
	'transactionTags',
	'transactionBatches',
	'batchTemplates'
])

// Durable attribution only; the source graph and credentials stay out of receipts.
export const appMergeOriginSchema = z.strictObject({
	organizationId: z.uuid(),
	sourceOrganizationId: z.uuid(),
	sourceEntity: mergeEntitySchema,
	sourceRecordId: z.uuid(),
	destinationRecordId: z.uuid()
})
