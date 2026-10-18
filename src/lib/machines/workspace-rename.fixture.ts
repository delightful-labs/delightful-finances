import { afterEach, vi } from 'vitest'
import { createActor, type SnapshotFrom } from 'xstate'
import type {
	WorkspaceRenameObservation,
	WorkspaceRenameReason,
	WorkspaceRenameScope
} from '#lib/workspace-rename-contract.js'
import { createWorkspaceRenameFormOptions, workspaceRenameScope } from './workspace-rename.js'
import { createScopedFormMachine, selectScopedFormView } from './scoped-form.js'

const cleanups: (() => void)[] = []
afterEach(() => {
	cleanups.splice(0).forEach((cleanup) => cleanup())
})

export function renameFixture() {
	const binding = {}
	let facts: WorkspaceRenameObservation = {
		binding,
		identityId: 'user',
		organizationId: 'workspace',
		sessionReady: true,
		workspaceLoading: false,
		membershipLoading: false,
		workspaceError: false,
		membershipError: false,
		workspace: { id: 'workspace', name: 'Home' },
		membership: { userId: 'user', organizationId: 'workspace', role: 'owner' }
	}
	const saved = Promise.withResolvers<unknown>()
	const observe = vi.fn(() => facts)
	const rename = vi.fn<(id: string, name: string) => Promise<unknown>>(() => saved.promise)
	const options = createWorkspaceRenameFormOptions({ binding, observe, rename })
	function owner(mode: 'create' | 'edit' = 'edit') {
		const createMode: { mode: 'create' } = { mode: 'create' }
		const config = mode === 'edit' ? options : { ...options, ...createMode }
		const actor = createActor(
			createScopedFormMachine<
				{ name: string },
				void,
				WorkspaceRenameReason,
				WorkspaceRenameScope,
				WorkspaceRenameObservation,
				SnapshotFrom<typeof options.availability>,
				SnapshotFrom<typeof options.operation>
			>(config),
			{ input: facts }
		).start()
		cleanups.push(() => actor.stop())
		const view = () =>
			selectScopedFormView<
				{ name: string },
				void,
				WorkspaceRenameReason,
				WorkspaceRenameScope,
				WorkspaceRenameObservation,
				SnapshotFrom<typeof options.availability>,
				SnapshotFrom<typeof options.operation>
			>(actor.getSnapshot(), config)
		return { actor, view }
	}
	function operation() {
		const actor = createActor(options.operation, { input: input() }).start()
		cleanups.push(() => actor.stop())
		return actor
	}
	function input() {
		return {
			request: {
				id: 1,
				scope: workspaceRenameScope(facts),
				scopeRevision: 0,
				values: { name: 'Office' }
			},
			observation: { revision: 0, facts }
		}
	}
	return {
		binding,
		observe,
		rename,
		saved,
		options,
		owner,
		operation,
		input,
		facts: () => facts,
		setFacts: (patch: Partial<WorkspaceRenameObservation>) => {
			facts = { ...facts, ...patch }
			return facts
		}
	}
}
