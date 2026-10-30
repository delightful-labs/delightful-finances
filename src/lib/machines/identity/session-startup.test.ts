import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { createSessionStartupMachine } from './session-startup.js'

describe('session startup', () => {
	it('waits for browser mount and ignores duplicate startup/retry events while opening', async () => {
		const pending = Promise.withResolvers<string>()
		const open = vi.fn(() => pending.promise)
		const actor = createActor(createSessionStartupMachine(open)).start()
		try {
			expect(actor.getSnapshot().matches('waiting')).toBe(true)
			expect(open).not.toHaveBeenCalled()
			actor.send({ type: 'RETRY' })
			expect(open).not.toHaveBeenCalled()
			actor.send({ type: 'START' })
			actor.send({ type: 'START' })
			actor.send({ type: 'RETRY' })
			expect(open).toHaveBeenCalledTimes(1)
			expect(actor.getSnapshot().matches('starting')).toBe(true)
			pending.resolve('session')
			await waitFor(actor, (state) => state.matches('ready'))
			expect(actor.getSnapshot().context.result).toBe('session')
		} finally {
			actor.stop()
		}
	})

	it('reuses an existing session without invoking startup', () => {
		const existing = { id: 'existing-session' }
		const open = vi.fn(async () => existing)
		const actor = createActor(createSessionStartupMachine(open, existing)).start()
		try {
			actor.send({ type: 'START' })
			actor.send({ type: 'RETRY' })
			expect(actor.getSnapshot().matches('ready')).toBe(true)
			expect(actor.getSnapshot().context.result).toBe(existing)
			expect(open).not.toHaveBeenCalled()
		} finally {
			actor.stop()
		}
	})

	it('allows repeated failure and retry without storing raw errors or secrets', async () => {
		const failure = new Error('Private failure detail')
		const open = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(failure)
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce('session')
		const actor = createActor(createSessionStartupMachine(open)).start()
		try {
			actor.send({ type: 'START' })
			await waitFor(actor, (state) => state.matches('error'))
			expect(actor.getSnapshot().context).toEqual({ result: undefined })
			actor.send({ type: 'RETRY' })
			await waitFor(actor, (state) => state.matches('error'))
			actor.send({ type: 'RETRY' })
			await waitFor(actor, (state) => state.matches('ready'))
			expect(open).toHaveBeenCalledTimes(3)
			expect(actor.getSnapshot().context).toEqual({ result: 'session' })
		} finally {
			actor.stop()
		}
	})

	it('ignores pending completion after its owner stops', async () => {
		const pending = Promise.withResolvers<string>()
		const actor = createActor(createSessionStartupMachine(() => pending.promise)).start()
		actor.send({ type: 'START' })
		actor.stop()
		pending.resolve('late session')
		await pending.promise
		await Promise.resolve()
		expect(actor.getSnapshot().context.result).toBeUndefined()
	})
})
