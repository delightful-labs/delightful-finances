import type { z } from 'zod'
import type {
	accountMergeJournalSchema,
	mergeDestinationSchema,
	mergeJournalCommandSchema
} from '../validation/account-merge-journal.js'

export type AccountMergeJournal = z.output<typeof accountMergeJournalSchema>
export type MergeDestination = z.output<typeof mergeDestinationSchema>
export type MergeJournalCommand = z.output<typeof mergeJournalCommandSchema>
