import { assign, setup, type SnapshotFrom } from 'xstate'
import type { ProfileObservation, ProfileReason, ProfileScope } from '#lib/profile-contract.js'
import type { FormCapability, FormChildEvent, FormObservation } from '#lib/form-contract.js'
import { createSingleWriteFormOptions } from './scoped-form-policy.js'
import {
	profileNameFormSchema,
	profileAvatarFormSchema,
	avatarMimeType
} from '#lib/validation/identity.js'
import type { z } from 'zod'

export function profileScope(f: ProfileObservation): ProfileScope {
	return { identityId: f.identityId, profileId: f.profile?.id ?? null, binding: f.binding }
}
export function sameProfileScope(a: ProfileScope, b: ProfileScope) {
	return a.identityId === b.identityId && a.profileId === b.profileId && a.binding === b.binding
}
export function createProfileAvailability(binding: object) {
	return setup<
		{ observation: FormObservation<ProfileObservation> },
		FormChildEvent<ProfileObservation>,
		{},
		{},
		{},
		{},
		never,
		string,
		FormObservation<ProfileObservation>
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
						}) => !f.profile || f.profile.userId !== f.identityId,
						target: 'profileUnavailable'
					},
					{ target: 'ready' }
				]
			},
			sessionUnavailable: {},
			loadFailed: {},
			loading: {},
			profileUnavailable: {},
			ready: {}
		}
	})
}
export function selectProfileAvailability(
	s: SnapshotFrom<ReturnType<typeof createProfileAvailability>>
): FormCapability<ProfileScope, ProfileReason> {
	const { revision, facts } = s.context.observation
	const state = s.value
	if (state === 'checking') throw new Error('Unassessed profile')
	return {
		revision,
		scope: profileScope(facts),
		readiness: state === 'ready' ? { kind: 'ready' } : { kind: 'blocked', reason: state }
	}
}
export function createProfileFormOptions(deps: {
	binding: object
	observe: () => ProfileObservation
	saveName: (id: string, user: string, name: string | null) => Promise<unknown>
	saveAvatar: (
		id: string,
		user: string,
		values: z.output<typeof profileAvatarFormSchema>
	) => Promise<unknown>
}) {
	const availability = createProfileAvailability(deps.binding)
	const common = {
		availability,
		selectAvailability: selectProfileAvailability,
		scopeOf: profileScope,
		sameScope: sameProfileScope,
		observe: deps.observe,
		classifyBlocked: (): 'unavailable' => 'unavailable'
	}
	const name = createSingleWriteFormOptions<
		z.output<typeof profileNameFormSchema>,
		void,
		ProfileReason,
		ProfileScope,
		ProfileObservation,
		SnapshotFrom<typeof availability>
	>({
		...common,
		successContent: 'retain',
		schema: profileNameFormSchema,
		mode: 'edit',
		initialValues: (f) => ({ displayName: f.profile?.displayName ?? null }),
		valuesEqual: (draft, initial) =>
			typeof draft === 'object' &&
			draft !== null &&
			'displayName' in draft &&
			typeof draft.displayName === 'string' &&
			(draft.displayName.trim() || null) === (initial.displayName ?? null),
		write: async ({ request }) => {
			const { profileId, identityId } = request.scope
			if (profileId === null || identityId === null) throw new Error('Missing authorized profile')
			await deps.saveName(profileId, identityId, request.values.displayName ?? null)
		}
	})
	const avatar = createSingleWriteFormOptions<
		z.output<typeof profileAvatarFormSchema>,
		void,
		ProfileReason,
		ProfileScope,
		ProfileObservation,
		SnapshotFrom<typeof availability>
	>({
		...common,
		successContent: 'retain',
		schema: profileAvatarFormSchema,
		resetOnSuccess: true,
		mode: 'edit',
		initialValues: (f) =>
			f.profile?.avatarData
				? {
						avatarData: Uint8Array.from(f.profile.avatarData),
						avatarMimeType: avatarMimeType.safeParse(f.profile.avatarMimeType).data ?? 'image/png'
					}
				: { avatarData: null, avatarMimeType: null },
		valuesEqual: (draft, initial) =>
			!(
				typeof draft === 'object' &&
				draft !== null &&
				'action' in draft &&
				((draft.action === 'upload' &&
					'file' in draft &&
					draft.file instanceof File &&
					draft.file.size > 0) ||
					(draft.action === 'remove' && initial.avatarData !== null))
			),
		write: async ({ request }) => {
			const { profileId, identityId } = request.scope
			if (profileId === null || identityId === null) throw new Error('Missing authorized profile')
			await deps.saveAvatar(profileId, identityId, request.values)
		}
	})
	return { name, avatar }
}
