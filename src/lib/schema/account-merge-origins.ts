import { schema as s } from 'jazz-tools'
import { mergeEntitySchema } from '../validation/account-merge-origins.js'

const entities = mergeEntitySchema.enum

export const mergeOriginsSchema = {
	mergeOrigins: s.table(
		{
			organizationId: s.uuid(),
			sourceOrganizationId: s.uuid(),
			sourceEntity: s.enum(
				entities.accounts,
				entities.categories,
				entities.tags,
				entities.transactions,
				entities.checkDetails,
				entities.transactionTags,
				entities.transactionBatches,
				entities.batchTemplates
			),
			sourceRecordId: s.uuid(),
			destinationRecordId: s.uuid()
		},
		{ organization: s.rel('organizations', 'organizationId') }
	)
}
