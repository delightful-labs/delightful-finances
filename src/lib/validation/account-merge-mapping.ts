import { z } from 'zod'
import { accountMergeSnapshotSchema, mergeSnapshotLimits } from './account-merge.js'
import { mergeDestinationSchema } from './account-merge-journal.js'
import { appCategorySchema } from './categories.js'

// Transient destination observations, not journal data or proof of hydration.
const category = appCategorySchema
	.pick({ organizationId: true, kind: true, isSystem: true, archivedAt: true })
	.extend({
		id: z.uuid(),
		isSystem: appCategorySchema.shape.isSystem.unwrap(),
		archivedAt: appCategorySchema.shape.archivedAt.unwrap()
	})

export const accountMergeMappingInputSchema = z.strictObject({
	snapshot: accountMergeSnapshotSchema,
	destination: mergeDestinationSchema,
	categories: z.array(category).max(mergeSnapshotLimits.records)
})
