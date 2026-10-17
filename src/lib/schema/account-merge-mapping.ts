import type { z } from 'zod'
import type { mergeEntitySchema } from '../validation/account-merge-origins.js'
import type { accountMergeMappingInputSchema } from '../validation/account-merge-mapping.js'

export type AccountMergeMappingInput = z.output<typeof accountMergeMappingInputSchema>
export type MergeEntity = z.output<typeof mergeEntitySchema>

export type MergeRecordMapping = {
	sourceId: string
	destinationId: string
	originId: string
} & (
	| { kind: 'origin'; entity: MergeEntity }
	| { kind: 'system-category'; entity: 'categories' }
	| { kind: 'provider-transaction'; entity: 'transactions' }
)

export type MergeMappingError =
	| 'invalid-input'
	| 'same-identity'
	| 'same-workspace'
	| 'invalid-destination-categories'
	| 'missing-system-category'
	| 'ambiguous-system-category'
	| 'identity-allocation-failed'

export type MergeMappingResult =
	| {
			outcome: 'mapped'
			destination: AccountMergeMappingInput['destination']
			records: readonly MergeRecordMapping[]
	  }
	| { outcome: 'failed'; code: MergeMappingError }
	| { outcome: 'cancelled' | 'closed' }
