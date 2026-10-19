import { normalizedName } from '#lib/domain/names.js'
import { assign, getInitialSnapshot, setup, type SnapshotFrom } from 'xstate'
import type { z } from 'zod'
import { createSingleWriteFormOptions } from './scoped-form-policy.js'
import type {
	FormOperationInput,
	FormCapability,
	FormChildEvent,
	FormObservation
} from '#lib/form-contract.js'
import type {
	ManagementObservation,
	ManagementReason,
	ManagementScope
} from '#lib/management-contract.js'
import { canEditCategoriesAndTags } from '#lib/domain/organization-permissions.js'

export function managementScope(facts: ManagementObservation): ManagementScope {
	return {
		identityId: facts.identityId,
		organizationId: facts.organizationId,
		binding: facts.binding
	}
}
export function sameManagementScope(a: ManagementScope, b: ManagementScope) {
	return (
		a.identityId === b.identityId &&
		a.organizationId === b.organizationId &&
		a.binding === b.binding
	)
}
export function createManagementAvailability(binding: object) {
	return setup<
		{ observation: FormObservation<ManagementObservation> },
		FormChildEvent<ManagementObservation>,
		{},
		{},
		{},
		{},
		never,
		string,
		FormObservation<ManagementObservation>
	>({}).createMachine({
		initial: 'checking',
		context: ({ input }) => ({ observation: input }),
		on: {
			OBSERVE: {
				target: '.checking',
				actions: assign({ observation: ({ event }) => event.observation })
			}
		},
		states: {
			checking: {
				always: [
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => !f.sessionReady || !f.identityId || f.binding !== binding,
						target: 'sessionUnavailable'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => !f.organizationId,
						target: 'selectWorkspace'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => f.failed,
						target: 'loadFailed'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => f.loading,
						target: 'loading'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) =>
							f.membership?.userId !== f.identityId ||
							!canEditCategoriesAndTags(f.membership, f.organizationId),
						target: 'readOnly'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) =>
							f.intent?.kind === 'archiveCategory' &&
							f.categories.some(
								(c) =>
									c.id === archiveIntentId(f) && c.organizationId === f.organizationId && c.isSystem
							),
						target: 'protectedRecord'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) =>
							f.intent?.kind === 'archiveCategory' &&
							(f.intent.organizationId !== f.organizationId ||
								!f.categories.some(
									(c) =>
										c.id === archiveIntentId(f) &&
										c.organizationId === f.organizationId &&
										c.archivedAt === null
								)),
						target: 'unavailableReference'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) =>
							f.intent?.kind === 'archiveTag' &&
							(f.intent.organizationId !== f.organizationId ||
								!f.tags.some(
									(t) =>
										t.id === archiveIntentId(f) &&
										t.organizationId === f.organizationId &&
										t.archivedAt === null
								)),
						target: 'unavailableReference'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => {
							const intent = f.intent
							return (
								intent?.kind === 'createTag' &&
								intent.categoryId !== null &&
								!f.categories.some(
									(category) =>
										category.id === intent.categoryId &&
										category.organizationId === f.organizationId &&
										category.kind === intent.tagKind &&
										category.archivedAt === null
								)
							)
						},
						target: 'unavailableReference'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => {
							const intent = f.intent
							return (
								intent?.kind === 'createTag' &&
								f.tags.some(
									(tag) =>
										tag.organizationId === f.organizationId &&
										tag.kind === intent.tagKind &&
										tag.archivedAt === null &&
										normalizedName(tag.name) === normalizedName(intent.name)
								)
							)
						},
						target: 'duplicateName'
					},
					{
						guard: ({
							context: {
								observation: { facts: f }
							}
						}) => {
							const intent = f.intent
							return (
								intent?.kind === 'createCategory' &&
								f.categories.some(
									(category) =>
										category.organizationId === f.organizationId &&
										category.archivedAt === null &&
										category.kind === intent.categoryKind &&
										normalizedName(category.name) === normalizedName(intent.name)
								)
							)
						},
						target: 'duplicateName'
					},
					{ target: 'ready' }
				]
			},
			sessionUnavailable: {},
			selectWorkspace: {},
			loadFailed: {},
			loading: {},
			readOnly: {},
			protectedRecord: {},
			unavailableReference: {},
			duplicateName: {},
			ready: {}
		}
	})
}
export function selectManagementAvailability(
	snapshot: SnapshotFrom<ReturnType<typeof createManagementAvailability>>
): FormCapability<ManagementScope, ManagementReason> {
	const { revision, facts } = snapshot.context.observation
	const state = snapshot.value
	if (state === 'checking') throw new Error('Unassessed management policy')
	return {
		revision,
		scope: managementScope(facts),
		readiness: state === 'ready' ? { kind: 'ready' } : { kind: 'blocked', reason: state }
	}
}
/** Uses exactly the same policy for each row as the pre-write assessment. */
export function selectManagementArchiveIds(
	facts: ManagementObservation,
	binding: object,
	kind: 'archiveCategory' | 'archiveTag'
) {
	// Pure projection of the same guards through a resource-free chart.
	const machine = createManagementAvailability(binding)
	return (kind === 'archiveCategory' ? facts.categories : facts.tags)
		.filter((row) => {
			const snapshot = selectManagementAvailability(
				getInitialSnapshot(machine, {
					revision: 0,
					facts: { ...facts, intent: { kind, id: row.id, organizationId: row.organizationId } }
				})
			)
			return snapshot.readiness.kind === 'ready'
		})
		.map((row) => row.id)
}

function archiveIntentId(f: ManagementObservation) {
	return f.intent?.kind === 'archiveCategory' || f.intent?.kind === 'archiveTag'
		? f.intent.id
		: undefined
}

/** Shared management policy binding; integrations supply each form's unique write and intent. */
export function createManagementFormOptions(dependencies: {
	binding: object
	observe: () => ManagementObservation
}) {
	const availability = createManagementAvailability(dependencies.binding)
	return function formOptions<Values, Result>(options: {
		schema: z.ZodType<Values>
		successContent: 'retain' | 'replace'
		assessmentObservation?: (
			input: FormOperationInput<Values, ManagementScope, ManagementObservation>
		) => ManagementObservation
		write: (
			input: FormOperationInput<Values, ManagementScope, ManagementObservation>
		) => Promise<Result>
	}) {
		return createSingleWriteFormOptions<
			Values,
			Result,
			ManagementReason,
			ManagementScope,
			ManagementObservation,
			SnapshotFrom<typeof availability>
		>({
			...options,
			mode: 'create',
			availability,
			selectAvailability: selectManagementAvailability,
			scopeOf: managementScope,
			sameScope: sameManagementScope,
			observe: dependencies.observe,
			classifyBlocked: (reason) =>
				reason === 'readOnly' || reason === 'protectedRecord' ? 'denied' : 'unavailable'
		})
	}
}
