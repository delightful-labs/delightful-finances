import { z } from 'zod'
import { accountMergeMappingInputSchema } from './account-merge-mapping.js'
import { accountMergeSnapshotSchema, mergeSnapshotLimits } from './account-merge.js'
import { appMergeOriginSchema } from './account-merge-origins.js'
import type { MergeEntity } from '../schema/account-merge-mapping.js'

const observations = (entity: MergeEntity) =>
	z.strictObject({
		targets: z
			.array(accountMergeSnapshotSchema.shape[entity].element)
			.max(mergeSnapshotLimits.records),
		receipts: z
			.array(appMergeOriginSchema.extend({ id: z.uuid() }))
			.max(mergeSnapshotLimits.records)
	})
// Observations cover the planned IDs and their required references. The integration
// must establish complete authorized reads; empty arrays alone prove nothing.
export const accountMergePreviewInputSchema = z
	.strictObject({
		mapping: accountMergeMappingInputSchema,
		observations: z.strictObject({
			accounts: observations('accounts'),
			categories: observations('categories'),
			tags: observations('tags'),
			transactions: observations('transactions'),
			checkDetails: observations('checkDetails'),
			transactionTags: observations('transactionTags'),
			transactionBatches: observations('transactionBatches'),
			batchTemplates: observations('batchTemplates')
		})
	})
	.superRefine((input, context) => {
		let count = 0
		for (const [entity, observed] of Object.entries(input.observations)) {
			for (const [collection, rows] of Object.entries(observed)) {
				count += rows.length
				const ids = new Set<string>()
				const origins = new Set<string>()
				for (const [index, row] of rows.entries()) {
					if (ids.has(row.id) || row.organizationId !== input.mapping.destination.organizationId)
						context.addIssue({
							code: 'custom',
							path: ['observations', entity, collection, index],
							message: 'invalid-destination-observation'
						})
					if (collection === 'receipts' && 'sourceRecordId' in row) {
						const origin = JSON.stringify([
							row.sourceOrganizationId,
							row.sourceEntity,
							row.sourceRecordId
						])
						if (origins.has(origin))
							context.addIssue({
								code: 'custom',
								path: ['observations', entity, collection, index],
								message: 'ambiguous-origin-observation'
							})
						origins.add(origin)
					}
					ids.add(row.id)
				}
			}
		}
		if (
			count > mergeSnapshotLimits.records * 2 ||
			new TextEncoder().encode(JSON.stringify(input)).byteLength > mergeSnapshotLimits.bytes * 3
		)
			context.addIssue({ code: 'custom', message: 'preview-observation-limit' })
	})
