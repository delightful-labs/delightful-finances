import type { z } from 'zod'
import type { accountMergePreviewInputSchema } from '../validation/account-merge-preview.js'
import type { MergeConflictInput, MergeRecordDecision } from './account-merge-conflict.js'
import type { MergeEntity } from './account-merge-mapping.js'
import type { MergeReferenceResult } from './account-merge-references.js'

export type MergePreviewInput = z.output<typeof accountMergePreviewInputSchema>
export type MergeDependency = { entity: MergeEntity; destinationId: string; field: string }
export type MergePreviewDecision =
	| MergeRecordDecision
	| {
			entity: MergeEntity
			sourceId: string
			destinationId: string
			originId: string
			outcome: 'blocked'
			reason: 'canonical-group' | 'unavailable-dependency' | 'incompatible-dependency'
			dependency: Pick<MergeDependency, 'entity' | 'destinationId'>
	  }
export type MergePreviewGraph = {
	records: MergeConflictInput[]
	byTarget: ReadonlyMap<string, readonly MergeConflictInput[]>
}
export type MergeDependencyInput = {
	record: MergeConflictInput
	graph: MergePreviewGraph
	decisions: ReadonlyMap<string, MergePreviewDecision>
}
export type MergeDependencyResult = { decision: MergePreviewDecision }
export type MergePreviewSummary = {
	decisions: MergePreviewDecision[]
	counts: {
		newTargets: number
		existingOrigins: number
		conflicts: number
		blocked: number
		newReceipts: number
	}
	excludedConnectionCount: number
}
export type MergePreviewResult =
	| ({ outcome: 'previewed' | 'partial' } & MergePreviewSummary)
	| {
			outcome: 'failed'
			code:
				| 'invalid-input'
				| 'invalid-observation'
				| 'preview-preparation-failed'
				| 'classification-failed'
				| 'dependency-check-failed'
				| Extract<MergeReferenceResult, { outcome: 'failed' }>['code']
	  }
	| { outcome: 'cancelled' | 'closed' }
