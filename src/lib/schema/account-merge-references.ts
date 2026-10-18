import type { AccountMergeSnapshot } from './account-merge.js'
import type {
	AccountMergeMappingInput,
	MergeEntity,
	MergeMappingError,
	MergeRecordMapping
} from './account-merge-mapping.js'

// Wire-format candidates, not Jazz insert inputs: archives are still ISO strings,
// reused system categories are not write requests, and collisions remain unresolved.
export type MergeReferenceCandidates = {
	[Entity in MergeEntity]: {
		mapping: MergeRecordMapping
		value: AccountMergeSnapshot[Entity][number]
	}[]
}
export type MergeReferencePlan = {
	destination: AccountMergeMappingInput['destination']
	candidates: MergeReferenceCandidates
	// Attribution only. These must never create active provider connections or links.
	bankAccountLinks: AccountMergeSnapshot['bankAccountLinks']
	excludedConnectionCount: number
}
export type MergeReferenceResult =
	| { outcome: 'prepared'; plan: MergeReferencePlan }
	| { outcome: 'failed'; code: MergeMappingError | 'reference-mapping-failed' }
	| { outcome: 'cancelled' | 'closed' }
