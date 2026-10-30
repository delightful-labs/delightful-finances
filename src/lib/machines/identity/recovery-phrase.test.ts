import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { createRecoveryPhraseMachine, selectRecoveryPhraseView } from './recovery-phrase.js'
const identity = { identityId: 'user', binding: {} }
describe('recovery phrase lifecycle', () => {
	it('confirms only a revealed phrase and clears confirmation and phrase on hide/reopen', async () => {
		const reveal = vi.fn(async () => 'synthetic test value')
		const actor = createActor(createRecoveryPhraseMachine(reveal), { input: identity }).start()
		actor.send({ type: 'CONFIRM', value: true })
		expect(selectRecoveryPhraseView(actor.getSnapshot()).kind).toBe('hidden')
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (s) => s.matches('revealed'))
		expect(selectRecoveryPhraseView(actor.getSnapshot())).toMatchObject({
			kind: 'revealed',
			confirmation: 'unconfirmed'
		})
		actor.send({ type: 'CONFIRM', value: true })
		expect(selectRecoveryPhraseView(actor.getSnapshot())).toMatchObject({
			confirmation: 'confirmed'
		})
		actor.send({ type: 'HIDE' })
		expect(actor.getSnapshot().context.phrase).toBeUndefined()
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (s) => s.matches('revealed'))
		expect(selectRecoveryPhraseView(actor.getSnapshot())).toMatchObject({
			confirmation: 'unconfirmed'
		})
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().context).toEqual({
			identity: { identityId: null, binding: null },
			phrase: undefined
		})
		actor.stop()
	})
	it.each(['hide', 'identity', 'binding', 'shutdown'])(
		'discards a delayed reveal after %s',
		async (change) => {
			const pending = Promise.withResolvers<string>()
			const actor = createActor(
				createRecoveryPhraseMachine(() => pending.promise),
				{ input: identity }
			).start()
			actor.send({ type: 'REVEAL' })
			actor.send({ type: 'REVEAL' })
			if (change === 'hide') actor.send({ type: 'HIDE' })
			if (change === 'identity')
				actor.send({ type: 'OBSERVE', identity: { ...identity, identityId: 'replacement' } })
			if (change === 'binding')
				actor.send({ type: 'OBSERVE', identity: { ...identity, binding: {} } })
			if (change === 'shutdown') actor.send({ type: 'SHUTDOWN' })
			pending.resolve('synthetic late value')
			await Promise.resolve()
			await Promise.resolve()
			expect(actor.getSnapshot().context.phrase).toBeUndefined()
			expect(selectRecoveryPhraseView(actor.getSnapshot()).kind).toBe(
				change === 'shutdown' ? 'closed' : 'hidden'
			)
			actor.stop()
		}
	)
	it('supervises failed export and retries without retaining phrase', async () => {
		const reveal = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error('private'))
			.mockResolvedValueOnce('synthetic retry')
		const actor = createActor(createRecoveryPhraseMachine(reveal), { input: identity }).start()
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (s) => s.matches('failed'))
		expect(selectRecoveryPhraseView(actor.getSnapshot())).toEqual({ kind: 'failed' })
		expect(actor.getSnapshot().context.phrase).toBeUndefined()
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (s) => s.matches('revealed'))
		actor.send({ type: 'HIDE' })
		actor.stop()
	})
	it('clears a confirmed phrase on same-user account replacement', async () => {
		const actor = createActor(
			createRecoveryPhraseMachine(async () => 'synthetic value'),
			{ input: identity }
		).start()
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (s) => s.matches('revealed'))
		actor.send({ type: 'CONFIRM', value: true })
		actor.send({ type: 'OBSERVE', identity: { ...identity, binding: {} } })
		expect(selectRecoveryPhraseView(actor.getSnapshot())).toEqual({ kind: 'hidden' })
		expect(actor.getSnapshot().context.phrase).toBeUndefined()
		actor.stop()
	})
})
