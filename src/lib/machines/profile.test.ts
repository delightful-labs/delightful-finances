import { describe, expect, it, vi } from 'vitest'
import { createActor, getInitialSnapshot, waitFor, type SnapshotFrom } from 'xstate'
import type { ProfileObservation, ProfileReason, ProfileScope } from '#lib/profile-contract.js'
import {
	createProfileAvailability,
	createProfileFormOptions,
	selectProfileAvailability
} from './profile.js'
import { createScopedFormMachine, selectScopedFormView } from './scoped-form.js'
const binding = {}
function facts(): ProfileObservation {
	return {
		identityId: 'user',
		binding,
		sessionReady: true,
		loading: false,
		failed: false,
		profile: {
			id: 'profile',
			userId: 'user',
			displayName: 'Name',
			avatarData: null,
			avatarMimeType: null
		}
	}
}
describe('profile policy/editing', () => {
	it.each([
		[{ identityId: null }, 'sessionUnavailable'],
		[{ binding: {} }, 'sessionUnavailable'],
		[{ sessionReady: false }, 'sessionUnavailable'],
		[{ failed: true, loading: true }, 'loadFailed'],
		[{ loading: true }, 'loading'],
		[{ profile: null }, 'profileUnavailable'],
		[{ profile: { id: 'other', userId: 'other' } }, 'profileUnavailable']
	] satisfies [Partial<ProfileObservation>, ProfileReason][])('blocks %j', (patch, reason) => {
		expect(
			selectProfileAvailability(
				getInitialSnapshot(createProfileAvailability(binding), {
					revision: 2,
					facts: { ...facts(), ...patch }
				})
			).readiness
		).toEqual({ kind: 'blocked', reason })
	})
	it('normalizes name edits and rechecks ownership before saving', async () => {
		let current = facts()
		const saveName = vi.fn(async () => undefined)
		const { name: options } = createProfileFormOptions({
			binding,
			observe: () => current,
			saveName,
			saveAvatar: async () => undefined
		})
		const machine = createScopedFormMachine<
			{ displayName: string | null },
			void,
			ProfileReason,
			ProfileScope,
			ProfileObservation,
			SnapshotFrom<typeof options.availability>,
			SnapshotFrom<typeof options.operation>
		>(options)
		const actor = createActor(machine, { input: current }).start()
		const view = () =>
			selectScopedFormView<
				{ displayName: string | null },
				void,
				ProfileReason,
				ProfileScope,
				ProfileObservation,
				SnapshotFrom<typeof options.availability>,
				SnapshotFrom<typeof options.operation>
			>(actor.getSnapshot(), options)
		expect(view()).toMatchObject({ canSubmit: false, fieldsEditable: true })
		actor.send({ type: 'CHANGE', values: { displayName: ' Name ' } })
		expect(view().canSubmit).toBe(false)
		actor.send({ type: 'CHANGE', values: { displayName: 'New' } })
		expect(view().canSubmit).toBe(true)
		actor.send({ type: 'SUBMIT', values: { displayName: ' New ' } })
		await waitFor(actor, (s) => s.context.result?.outcome === 'succeeded')
		expect(saveName).toHaveBeenCalledExactlyOnceWith('profile', 'user', 'New')
		current = { ...current, profile: { id: 'profile', userId: 'other', displayName: 'Name' } }
		actor.send({ type: 'SUBMIT', values: { displayName: 'Forbidden' } })
		await waitFor(actor, (s) => s.context.result?.outcome === 'unavailable')
		expect(saveName).toHaveBeenCalledTimes(1)
		actor.stop()
	})
	it('avatar edit comparison requires a file or a present avatar to remove', () => {
		const options = createProfileFormOptions({
			binding,
			observe: facts,
			saveName: async () => undefined,
			saveAvatar: async () => undefined
		}).avatar
		if (options.mode !== 'edit') throw new Error('edit expected')
		const initial = options.initialValues(facts())
		expect(options.valuesEqual(undefined, initial)).toBe(true)
		expect(options.valuesEqual({ action: 'remove' }, initial)).toBe(true)
		expect(
			options.valuesEqual(
				{ action: 'upload', file: new File(['image'], 'avatar.png', { type: 'image/png' }) },
				initial
			)
		).toBe(false)
		expect(
			options.valuesEqual(
				{ action: 'remove' },
				{ action: 'upload', file: new File(['saved'], 'avatar.png', { type: 'image/png' }) }
			)
		).toBe(false)
	})
})
