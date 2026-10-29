import { describe, expect, it, vi } from 'vitest'
import { createActor, createMachine, fromPromise } from 'xstate'
import { stopAfterShutdown } from './actor-lifecycle.js'

describe('actor owner shutdown', () => {
	it('keeps the actor alive until asynchronous cleanup finishes', async () => {
		const cleanup = Promise.withResolvers<void>()
		const released = vi.fn()
		const actor = createActor(
			createMachine({
				initial: 'ready',
				states: {
					ready: { on: { SHUTDOWN: 'draining' } },
					draining: {
						invoke: {
							src: fromPromise(async () => {
								await cleanup.promise
								released()
							}),
							onDone: 'closed'
						}
					},
					closed: { type: 'final' }
				}
			})
		).start()
		const stop = vi.spyOn(actor, 'stop')
		try {
			stopAfterShutdown(actor)
			expect(actor.getSnapshot().matches('draining')).toBe(true)
			expect(stop).not.toHaveBeenCalled()
			cleanup.resolve()
			await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
			expect(released).toHaveBeenCalledOnce()
		} finally {
			cleanup.resolve()
			actor.stop()
		}
	})

	it('stops once when shutdown completes synchronously or the actor is already final', () => {
		const machine = createMachine({
			initial: 'ready',
			states: {
				ready: { on: { SHUTDOWN: 'closed' } },
				closed: { type: 'final' }
			}
		})
		const active = createActor(machine).start()
		const activeStop = vi.spyOn(active, 'stop')
		stopAfterShutdown(active)
		expect(active.getSnapshot().status).toBe('done')
		expect(activeStop).toHaveBeenCalledOnce()

		const finished = createActor(machine).start()
		finished.send({ type: 'SHUTDOWN' })
		const finishedStop = vi.spyOn(finished, 'stop')
		const finishedSend = vi.spyOn(finished, 'send')
		stopAfterShutdown(finished)
		expect(finishedSend).not.toHaveBeenCalled()
		expect(finishedStop).toHaveBeenCalledOnce()
	})
})
