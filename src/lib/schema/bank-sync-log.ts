import { schema as s } from 'jazz-tools'
import {
	syncCount,
	syncFailureCode,
	syncOutcome,
	syncSettlement
} from '../validation/bank-sync-log.js'

const count = () =>
	s
		.int()
		.transform<number>({
			from: (value) => syncCount.parse(value),
			to: (value) => syncCount.parse(value)
		})
		.optional()
const counts = () => ({ importedCount: count(), existingCount: count(), omittedCount: count() })

export const bankSyncLogSchema = {
	simplefinSyncAttempts: s.table(
		{
			organizationId: s.uuid(),
			connectionId: s.uuid(),
			initiatedBy: s.uuid(),
			startedAt: s.timestamp(),
			finishedAt: s.timestamp().optional(),
			outcome: s.enum(
				syncOutcome.enum.unfinished,
				syncOutcome.enum.succeeded,
				syncOutcome.enum.partial,
				syncOutcome.enum.failed,
				syncOutcome.enum.cancelled
			),
			importSettlement: s.enum(
				syncSettlement.enum.notStarted,
				syncSettlement.enum.locallyPersisted,
				syncSettlement.enum.confirmed,
				syncSettlement.enum.unresolved
			),
			failureCode: s
				.enum(
					syncFailureCode.enum.authorization,
					syncFailureCode.enum.passkey,
					syncFailureCode.enum.provider,
					syncFailureCode.enum.mapping,
					syncFailureCode.enum.import,
					syncFailureCode.enum.interrupted,
					syncFailureCode.enum.unexpected
				)
				.optional(),
			...counts()
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			connection: s.rel('simplefinConnections', 'connectionId')
		}
	),
	simplefinSyncAccountResults: s.table(
		{
			attemptId: s.uuid(),
			organizationId: s.uuid(),
			accountId: s.uuid(),
			accountName: s.string(),
			outcome: s.enum(
				syncOutcome.enum.unfinished,
				syncOutcome.enum.succeeded,
				syncOutcome.enum.partial,
				syncOutcome.enum.failed,
				syncOutcome.enum.cancelled
			),
			failureCode: s
				.enum(
					syncFailureCode.enum.authorization,
					syncFailureCode.enum.passkey,
					syncFailureCode.enum.provider,
					syncFailureCode.enum.mapping,
					syncFailureCode.enum.import,
					syncFailureCode.enum.interrupted,
					syncFailureCode.enum.unexpected
				)
				.optional(),
			...counts()
		},
		{
			attempt: s.rel('simplefinSyncAttempts', 'attemptId'),
			organization: s.rel('organizations', 'organizationId'),
			account: s.rel('accounts', 'accountId')
		}
	)
}
