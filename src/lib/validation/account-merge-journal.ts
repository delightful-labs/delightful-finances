import { z } from 'zod'
import { accountMergeSnapshotSchema } from './account-merge.js'

export const mergeDestinationSchema = z.strictObject({
	identityId: z.uuid(),
	organizationId: z.uuid()
})

export const accountMergeJournalSchema = z.strictObject({
	version: z.literal(1),
	operationId: z.uuid(),
	snapshot: accountMergeSnapshotSchema,
	destination: mergeDestinationSchema.nullable()
})

export const mergeJournalCommandSchema = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('LOAD') }),
	z.strictObject({ type: z.literal('CREATE'), journal: accountMergeJournalSchema }),
	z.strictObject({
		type: z.literal('BIND'),
		operationId: z.uuid(),
		destination: mergeDestinationSchema
	}),
	z.strictObject({ type: z.literal('DISCARD'), operationId: z.uuid() })
])
