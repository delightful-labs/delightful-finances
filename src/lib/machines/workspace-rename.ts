import { assign, setup, type SnapshotFrom } from 'xstate'
import type { FormCapability, FormChildEvent, FormObservation } from '#lib/form-contract.js'
import type {
	WorkspaceRenameObservation,
	WorkspaceRenameReason,
	WorkspaceRenameScope
} from '#lib/workspace-rename-contract.js'
import { workspaceNameFormSchema } from '#lib/validation/identity.js'
import { createSingleWriteFormOptions } from './scoped-form-policy.js'

type Values = { name: string }

export function workspaceRenameScope(facts: WorkspaceRenameObservation): WorkspaceRenameScope {
	return {
		identityId: facts.identityId,
		organizationId: facts.organizationId,
		binding: facts.binding
	}
}
export function sameWorkspaceRenameScope(
	currentScope: WorkspaceRenameScope,
	incomingScope: WorkspaceRenameScope
) {
	return (
		currentScope.identityId === incomingScope.identityId &&
		currentScope.organizationId === incomingScope.organizationId &&
		currentScope.binding === incomingScope.binding
	)
}

/** One domain policy chart, used for displayed availability and pre-write authorization. */
export function createWorkspaceRenameAvailability(binding: object) {
	return setup<
		{ observation: FormObservation<WorkspaceRenameObservation> },
		FormChildEvent<WorkspaceRenameObservation>,
		{},
		{},
		{},
		{},
		never,
		string,
		FormObservation<WorkspaceRenameObservation>
	>({}).createMachine({
		id: 'workspace-rename-availability',
		initial: 'assessing',
		context: ({ input }) => ({ observation: input }),
		on: {
			OBSERVE: {
				target: '.assessing',
				actions: assign({ observation: ({ event }) => event.observation })
			}
		},
		states: {
			assessing: {
				always: [
					{
						guard: ({
							context: {
								observation: { facts }
							}
						}) => !facts.sessionReady || !facts.identityId || facts.binding !== binding,
						target: 'sessionUnavailable'
					},
					{
						guard: ({
							context: {
								observation: { facts }
							}
						}) => !facts.organizationId,
						target: 'selectWorkspace'
					},
					{
						guard: ({
							context: {
								observation: { facts }
							}
						}) => facts.workspaceError || facts.membershipError,
						target: 'loadFailed'
					},
					{
						guard: ({
							context: {
								observation: { facts }
							}
						}) => facts.workspaceLoading || facts.membershipLoading,
						target: 'loading'
					},
					{
						guard: ({
							context: {
								observation: { facts }
							}
						}) => facts.workspace?.id !== facts.organizationId,
						target: 'workspaceUnavailable'
					},
					{
						guard: ({
							context: {
								observation: { facts }
							}
						}) =>
							facts.membership?.userId !== facts.identityId ||
							facts.membership?.organizationId !== facts.organizationId ||
							(facts.membership?.role !== 'owner' && facts.membership?.role !== 'admin'),
						target: 'readOnly'
					},
					{ target: 'ready' }
				]
			},
			sessionUnavailable: {},
			selectWorkspace: {},
			loadFailed: {},
			loading: {},
			workspaceUnavailable: {},
			readOnly: {},
			ready: {}
		}
	})
}
export function selectWorkspaceRenameAvailability(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkspaceRenameAvailability>>
): FormCapability<WorkspaceRenameScope, WorkspaceRenameReason> {
	const { revision, facts } = snapshot.context.observation
	const state = snapshot.value
	if (state === 'assessing') throw new Error('Workspace readiness has not been assessed')
	return {
		revision,
		scope: workspaceRenameScope(facts),
		readiness: state === 'ready' ? { kind: 'ready' } : { kind: 'blocked', reason: state }
	}
}

export function createWorkspaceRenameFormOptions(dependencies: {
	binding: object
	observe: () => WorkspaceRenameObservation
	rename: (organizationId: string, name: string) => Promise<unknown>
}) {
	const availability = createWorkspaceRenameAvailability(dependencies.binding)
	return createSingleWriteFormOptions<
		Values,
		void,
		WorkspaceRenameReason,
		WorkspaceRenameScope,
		WorkspaceRenameObservation,
		SnapshotFrom<typeof availability>
	>({
		schema: workspaceNameFormSchema,
		mode: 'edit',
		initialValues: (facts: WorkspaceRenameObservation): Values => ({
			name: facts.workspace?.name ?? ''
		}),
		valuesEqual: (draft: unknown, initial: Values) =>
			typeof draft === 'object' &&
			draft !== null &&
			'name' in draft &&
			typeof draft.name === 'string' &&
			draft.name.trim() === initial.name,

		availability,
		selectAvailability: selectWorkspaceRenameAvailability,
		scopeOf: workspaceRenameScope,
		sameScope: sameWorkspaceRenameScope,
		observe: dependencies.observe,
		classifyBlocked: (reason) => (reason === 'readOnly' ? 'denied' : 'unavailable'),
		successContent: 'retain',
		write: async ({ request }) => {
			// Defensive type invariant; eligibility is decided by the shared policy chart.
			const id = request.scope.organizationId
			if (id === null) throw new Error('Missing authorized workspace')
			await dependencies.rename(id, request.values.name)
		}
	})
}
