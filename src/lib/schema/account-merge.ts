import type { z } from 'zod'
import type { accountMergeSnapshotSchema } from '../validation/account-merge.js'

// Device-local wire format, deliberately separate from the Jazz application schema.
export type AccountMergeSnapshot = z.output<typeof accountMergeSnapshotSchema>
