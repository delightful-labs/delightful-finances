import { z } from 'zod'
import { accountMergeSnapshotSchema, mergeSnapshotLimits } from './account-merge.js'
import { mergeDestinationSchema } from './account-merge-journal.js'
import { appMergeOriginSchema, mergeEntitySchema } from './account-merge-origins.js'
import type { MergeEntity } from '../schema/account-merge-mapping.js'

const identity = z.strictObject({
	entity: mergeEntitySchema,
	kind: z.enum(['origin', 'system-category', 'provider-transaction']),
	sourceId: z.uuid(),
	destinationId: z.uuid(),
	originId: z.uuid()
})
const observation = <Entity extends MergeEntity>(entity: Entity) => {
	// Reuse the lossless snapshot row validators, not transforming form adapters.
	const row = accountMergeSnapshotSchema.shape[entity].element
	return z.strictObject({
		entity: z.literal(entity),
		sourceOrganizationId: z.uuid(),
		destination: mergeDestinationSchema,
		candidate: z.strictObject({ mapping: identity, value: row }),
		target: row.nullable(),
		receipt: appMergeOriginSchema.extend({ id: z.uuid() }).nullable(),
		// Peer values or equality witnesses from complete graph grouping.
		// The graph owner must not omit a differing peer; this is not hydration proof.
		peers: z.array(row).max(mergeSnapshotLimits.records)
	})
}

// A supplied null target/receipt means an observed absence, never a failed read.
// The integration owner must establish authorized, complete observations separately.
export const accountMergeConflictInputSchema = z.discriminatedUnion('entity', [
	observation('accounts'),
	observation('categories'),
	observation('tags'),
	observation('transactions'),
	observation('checkDetails'),
	observation('transactionTags'),
	observation('transactionBatches'),
	observation('batchTemplates')
])
