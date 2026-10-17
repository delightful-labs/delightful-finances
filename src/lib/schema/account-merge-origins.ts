import { schema as s } from 'jazz-tools'
import type { MergeEntity } from './account-merge-mapping.js'
import { mergeEntitySchema } from '../validation/account-merge-origins.js'

const entities = mergeEntitySchema.enum

const originColumns = () => ({
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
})

// Retained for additive compatibility; permissions deny access to this unusable table.
const legacyMergeOrigins = s.table(originColumns(), {
	organization: s.rel('organizations', 'organizationId')
})

// Each destination UUID has one declared target, as required by Jazz write policies.
const originTable = (entity: MergeEntity) =>
	s.table(originColumns(), {
		organization: s.rel('organizations', 'organizationId'),
		destination: s.rel(entity, 'destinationRecordId')
	})

export const mergeOriginTables = {
	accounts: 'mergeAccountOrigins',
	categories: 'mergeCategoryOrigins',
	tags: 'mergeTagOrigins',
	transactions: 'mergeTransactionOrigins',
	checkDetails: 'mergeCheckDetailOrigins',
	transactionTags: 'mergeTransactionTagOrigins',
	transactionBatches: 'mergeTransactionBatchOrigins',
	batchTemplates: 'mergeBatchTemplateOrigins'
} satisfies Record<MergeEntity, `merge${string}Origins`>

export const mergeOriginsSchema = {
	mergeOrigins: legacyMergeOrigins,
	[mergeOriginTables.accounts]: originTable(entities.accounts),
	[mergeOriginTables.categories]: originTable(entities.categories),
	[mergeOriginTables.tags]: originTable(entities.tags),
	[mergeOriginTables.transactions]: originTable(entities.transactions),
	[mergeOriginTables.checkDetails]: originTable(entities.checkDetails),
	[mergeOriginTables.transactionTags]: originTable(entities.transactionTags),
	[mergeOriginTables.transactionBatches]: originTable(entities.transactionBatches),
	[mergeOriginTables.batchTemplates]: originTable(entities.batchTemplates)
}
