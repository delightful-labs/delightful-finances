import type { AccountMergeSnapshot } from './account-merge.js'
import type {
	MergeDestination,
	MergeDestinationSession,
	MergeObservationCallbacks
} from './account-merge-destination.js'

export const mergeCaptureScopes = [
	'sourceOrganization',
	'accounts',
	'categories',
	'tags',
	'transactions',
	'checkDetails',
	'transactionTags',
	'transactionBatches',
	'batchTemplates',
	'bankAccountLinks',
	'connections'
] satisfies readonly (keyof AccountMergeSnapshot | 'connections')[]
export type MergeCaptureScope = (typeof mergeCaptureScopes)[number]
export type MergeCaptureRows = Partial<Record<MergeCaptureScope, readonly unknown[]>>
export type MergeCaptureDependencies = {
	binding: object
	session: (callbacks: MergeObservationCallbacks<MergeDestinationSession>) => () => void
	read: (
		source: MergeDestination,
		scope: MergeCaptureScope,
		callbacks: MergeObservationCallbacks<readonly unknown[]>
	) => () => void
	attachments: (
		transactionIds: string[],
		callbacks: MergeObservationCallbacks<readonly unknown[]>
	) => () => void
}
export type MergeCaptureResult =
	| { outcome: 'captured'; snapshot: AccountMergeSnapshot }
	| { outcome: 'invalid'; issues: { path: string; code: string }[] }
	| {
			outcome: 'failed'
			code: 'invalid-input' | 'scope-changed' | 'read-failed' | 'timeout' | 'validation-failed'
	  }
	| { outcome: 'cancelled' | 'closed' }
