import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor, type SnapshotFrom } from 'xstate'
import type { z } from 'zod'
import type { profileAvatarFormSchema } from '#lib/validation/identity.js'
import type { ProfileObservation, ProfileReason, ProfileScope } from '#lib/profile-contract.js'
import { createProfileFormOptions } from './profile.js'
import { createScopedFormMachine, selectScopedFormView } from './scoped-form.js'
vi.mock('#lib/domain/avatar.js', () => ({
	resizeAvatar: async () => new Blob(['processed'], { type: 'image/webp' })
}))
it('shared success reset releases the uploaded file, rebuilds fields and preserves saved feedback', async () => {
	const binding = {}
	const facts: ProfileObservation = {
		identityId: 'user',
		binding,
		sessionReady: true,
		loading: false,
		failed: false,
		profile: { id: 'profile', userId: 'user', avatarData: null, avatarMimeType: null }
	}
	const saveAvatar = vi.fn(async () => undefined)
	const options = createProfileFormOptions({
		binding,
		observe: () => facts,
		saveAvatar,
		saveName: async () => undefined
	}).avatar
	const machine = createScopedFormMachine<
		z.output<typeof profileAvatarFormSchema>,
		void,
		ProfileReason,
		ProfileScope,
		ProfileObservation,
		SnapshotFrom<typeof options.availability>,
		SnapshotFrom<typeof options.operation>
	>(options)
	const actor = createActor(machine, { input: facts }).start()
	const file = new File(['original'], 'avatar.png', { type: 'image/png' })
	actor.send({ type: 'CHANGE', values: { action: 'upload', file } })
	actor.send({ type: 'SUBMIT', values: { action: 'upload', file } })
	await waitFor(actor, (s) => s.context.result?.outcome === 'succeeded')
	expect(saveAvatar).toHaveBeenCalledTimes(1)
	expect(actor.getSnapshot().context.draft).toBeUndefined()
	expect(actor.getSnapshot().context.request).toBeUndefined()
	expect(
		selectScopedFormView<
			z.output<typeof profileAvatarFormSchema>,
			void,
			ProfileReason,
			ProfileScope,
			ProfileObservation,
			SnapshotFrom<typeof options.availability>,
			SnapshotFrom<typeof options.operation>
		>(actor.getSnapshot(), options)
	).toMatchObject({
		draftRevision: 1,
		canSubmit: false,
		fieldsEditable: true,
		feedback: { kind: 'result', result: { outcome: 'succeeded' } }
	})
	actor.send({
		type: 'CHANGE',
		values: { action: 'upload', file: new File(['replacement'], 'next.png', { type: 'image/png' }) }
	})
	expect(actor.getSnapshot().context.result).toBeUndefined()
	actor.send({ type: 'SHUTDOWN' })
	actor.stop()
})
