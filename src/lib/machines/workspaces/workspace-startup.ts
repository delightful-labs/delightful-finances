import type { SnapshotFrom, OutputFrom } from 'xstate'
import { createWorkspaceStartupMachine as createSharedStartup } from 'delightful-local-first/workspace/startup'
import type { getDb } from 'jazz-tools/svelte'
import { workspaceInitialization } from './workspace-initialization.js'
import { workspaceFakeData } from './workspace-fake-data.js'
type Db = Pick<
	ReturnType<typeof getDb>,
	'all' | 'beginTransaction' | 'beginExclusiveTransaction' | 'getConfig'
>
export function createWorkspaceStartupMachine(db: Db) {
	return createSharedStartup<
		Db,
		OutputFrom<typeof workspaceInitialization>,
		OutputFrom<typeof workspaceFakeData>,
		SnapshotFrom<typeof workspaceInitialization>,
		SnapshotFrom<typeof workspaceFakeData>
	>({
		db,
		initialize: workspaceInitialization,
		seed: workspaceFakeData,
		ready: (result) => (result?.outcome === 'ready' ? result : undefined),
		initializationFailure: (error) => ({ outcome: 'failed', settlement: 'unresolved', error }),
		seedFailure: (error) => ({ outcome: 'failed', settlement: 'unresolved', error })
	})
}
