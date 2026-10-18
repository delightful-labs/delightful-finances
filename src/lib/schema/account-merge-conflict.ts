import type { z } from 'zod'
import type { accountMergeConflictInputSchema } from '../validation/account-merge-conflict.js'

export type MergeConflictInput = z.output<typeof accountMergeConflictInputSchema>
export type MergeConflictReason =
	| 'invalid-provenance'
	| 'missing-system-category'
	| 'invalid-system-category'
	| 'source-provider-collision'
	| 'provider-values'
	| 'destination-collision'
export type MergeDecisionOutcome =
	| { outcome: 'addition' }
	| { outcome: 'existing'; reason: 'recorded-origin' | 'system-category' | 'provider-identity' }
	| { outcome: 'conflict'; reason: MergeConflictReason }
export type MergeRecordDecision = {
	entity: MergeConflictInput['entity']
	sourceId: string
	destinationId: string
	originId: string
} & MergeDecisionOutcome
// Record classification is not graph readiness, a write request or import success.
export type MergeConflictResult =
	| { outcome: 'classified'; decision: MergeRecordDecision }
	| { outcome: 'failed'; code: 'invalid-input' | 'invalid-observation' }
