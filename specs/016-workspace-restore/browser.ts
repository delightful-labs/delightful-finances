import { createJazzSession, createJazzClient } from 'jazz-tools/client'
import { app as isolationApp, previousApp as originalApp } from '../../src/lib/schema.js'

// Test-only SDK bindings. The host test owns every operation and resource lifetime.
const probe = {
	createJazzSession,
	createJazzClient,
	app: isolationApp,
	originalApp
}
declare global {
	interface Window {
		financeRestoreIsolation: typeof probe
		upgradeRestoreIsolation(): Promise<void>
	}
}
if (typeof window !== 'undefined') window.financeRestoreIsolation = probe

import {
	createFinanceRestoreSession,
	createFinanceWorkspaceRestore,
	createWorkspaceRestoreController,
	prepareWorkspaceRestoreFile,
	bindWorkspaceRestoreFile,
	selectWorkspaceRestoreReport,
	createFinanceRestoreAdapter,
	readRecovery,
	recoveryQueries,
	type FinanceRestoreDb
} from '../../src/lib/machines/workspaces/workspace-restore.js'
import { assign, fromPromise, setup, forwardTo, createActor, toPromise, waitFor } from 'xstate'
import type { Transaction, WriteHandle } from 'jazz-tools'
import {
	createRestoreMachine,
	createRestoreJournalStepMachine
} from 'delightful-local-first/backup/restore/workflow'
import {
	type RestoreDestinationInput,
	type RestoreDestinationResult,
	type RestoreEvent,
	type RestoreTransactionWriter
} from 'delightful-local-first/backup/restore'
import { sameBackupBinding } from 'delightful-local-first/backup/binding'
import {
	parseRestoreJournalRecord,
	type RestoreJournalIntent
} from 'delightful-local-first/backup/restore/journal'
import { parseArchivePayload } from 'delightful-local-first/backup/archive'
import type { IntegrityCheckedArchive } from 'delightful-local-first/backup/envelope'
import { prepareArchiveOpen } from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import { financeBackupProfile } from '../../src/lib/backup/workspace.js'
import { financeBackupReader } from '../../src/lib/machines/workspaces/workspace-backup.js'
import { prepareJazzArchiveExport } from 'delightful-local-first/backend/jazz/backup'
import { createJazzArchiveExportMachine } from 'delightful-local-first/backup/export/workflow'
import {
	canonicalRecovery,
	financeGraphRows,
	type FinanceRestoreGraph,
	financeRestorePlanningMachine,
	prepareFinanceRestorePlan,
	restorePartBytes
} from '../../src/lib/machines/workspaces/workspace-restore-plan.js'
export { canonicalRecovery }
export type RecoveryGraph = FinanceRestoreGraph
export type RecoverySample = {
	file: number[]
	intent: RestoreJournalIntent
	graph: RecoveryGraph
	databaseName: string
}
type RecoveryInput = RestoreDestinationInput<Transaction<'mergeable'>>
/** Instrumentation only: the application owns every native read, comparison and transaction. */
export function createRecoveryProbe(
	db: FinanceRestoreDb,
	sample: RecoverySample,
	archive: IntegrityCheckedArchive,
	heldWriteId?: string,
	retain?: RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
) {
	const detached: Parameters<
		RestoreTransactionWriter<Transaction<'mergeable'>, WriteHandle>['retainDetached']
	>[0][] = []
	const adapter = createFinanceRestoreAdapter(
		db,
		sample,
		archive,
		retain ?? ((receipt) => detached.push(receipt))
	)
	const commits: string[] = []
	const commit = adapter.writer.commit
	adapter.writer.commit = (tx) => {
		const write = commit(tx)
		void Promise.resolve(write)
			.then((value) => adapter.writer.transactionId(value))
			.then(
				(id) => commits.push(id),
				() => {}
			)
		return write
	}
	const actors = {
		native: adapter.destination,
		pause: fromPromise<void>(() => window.pauseRecoveryReplies())
	}
	const guarded = setup<
		{
			input: RecoveryInput
			result: RestoreDestinationResult
			interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		},
		RestoreEvent,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		RecoveryInput,
		RestoreDestinationResult
	>({ actors })
	const latch = guarded.assign({
		interruption: ({ context, event }) =>
			event.type === 'SHUTDOWN'
				? 'closed'
				: (context.interruption ?? (event.type === 'CANCEL' ? 'cancelled' : 'invalidated'))
	})
	const wire = guarded.createMachine({
		context: ({ input }) => ({ input, result: 'unavailable', interruption: undefined }),
		initial: 'checking',
		output: ({ context }) => context.interruption ?? context.result,
		on: {
			CANCEL: { actions: latch },
			SHUTDOWN: { actions: latch },
			INVALIDATE: {
				guard: ({ context, event }) => sameBackupBinding(context.input.binding, event.binding),
				actions: latch
			}
		},
		states: {
			checking: {
				on: {
					CANCEL: { actions: [latch, forwardTo('native')] },
					SHUTDOWN: { actions: [latch, forwardTo('native')] },
					INVALIDATE: {
						guard: ({ context, event }) => sameBackupBinding(context.input.binding, event.binding),
						actions: [latch, forwardTo('native')]
					}
				},
				invoke: {
					id: 'native',
					src: 'native',
					input: ({ context }) => context.input,
					onDone: [
						{
							guard: ({ context, event }) =>
								!context.interruption &&
								event.output === 'allowed' &&
								context.input.operation === 'authority' &&
								context.input.step.writeId === heldWriteId,
							target: 'holding'
						},
						{ target: 'complete', actions: assign({ result: ({ event }) => event.output }) }
					],
					onError: 'complete'
				}
			},
			holding: {
				invoke: {
					src: 'pause',
					onDone: { target: 'complete', actions: assign({ result: 'allowed' }) },
					onError: 'complete'
				}
			},
			complete: { type: 'final' }
		}
	})
	return {
		...adapter,
		machine: createRestoreMachine(adapter.writer, wire),
		commits,
		detached
	}
}

const recovery = {
	financeBackupReader,
	financeBackupProfile,
	prepareJazzArchiveExport,
	createJazzArchiveExportMachine,
	createActor,
	toPromise,
	waitFor,
	createRestoreJournalStepMachine,
	parseRestoreJournalRecord,
	prepareArchiveOpen,
	createArchiveEnvelopeMachine,
	parseArchivePayload,
	createRecoveryProbe,
	createFinanceRestoreSession,
	createFinanceWorkspaceRestore,
	createWorkspaceRestoreController,
	prepareWorkspaceRestoreFile,
	bindWorkspaceRestoreFile,
	selectWorkspaceRestoreReport,
	readRecovery,
	recoveryQueries,
	canonicalRecovery,
	financeGraphRows,
	financeRestorePlanningMachine,
	prepareFinanceRestorePlan,
	restorePartBytes
}
declare global {
	interface Window {
		financeRestoreRecovery: typeof recovery
		pauseRecoveryReplies(): Promise<void>
		financeRecoveryOwner: Awaited<ReturnType<typeof createJazzSession>>
		financeRestoreCatalog: { published: Promise<void>; close(): void }
		financeRestoreSessionRuntime: {
			actor: import('xstate').ActorRefFrom<ReturnType<typeof createFinanceRestoreSession>>
			stats: {
				acquisitions: number
				opened: number
				closeAttempts: number
				releases: number
				transactions: number
				rollbackAttempts: number
			}
			transactionOpened: Promise<void>
			commits(): string[]
			releaseAcquisition(): void
			releaseTransaction(): void
		}
		financeRecoveryRuntime: {
			client: Awaited<ReturnType<typeof createJazzClient>>
			sample: RecoverySample
			probe: ReturnType<typeof createRecoveryProbe>
			binding: RecoveryInput['binding']
			opened: import('delightful-local-first/backup/envelope').ArchiveEnvelopeRequest
			archive: IntegrityCheckedArchive
			actor:
				import('xstate').ActorRefFrom<ReturnType<typeof createRecoveryProbe>['machine']> | undefined
		}
	}
}
if (typeof window !== 'undefined') window.financeRestoreRecovery = recovery
