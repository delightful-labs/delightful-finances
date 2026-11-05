import { afterEach, expect, it, vi } from 'vitest'
import { createActor, setup, toPromise, type AnyActorRef } from 'xstate'
import { setImmediate } from 'node:timers/promises'
import { createAccountImportMachine } from './import-account.js'
import { connection, dependencies, id } from './test-fixtures.js'
import type { OperationWork } from './types.js'

const actors: AnyActorRef[] = []
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})
function startYield() {
	const channel = new MessageChannel()
	const firstClose = vi.spyOn(channel.port1, 'close'),
		secondClose = vi.spyOn(channel.port2, 'close')
	vi.stubGlobal(
		'MessageChannel',
		class {
			port1 = channel.port1
			port2 = channel.port2
		}
	)
	const continued = Promise.withResolvers<void>()
	const events: string[] = []
	const logic = createAccountImportMachine(dependencies()).implementations.actors?.yieldControl
	if (!logic || !('getInitialSnapshot' in logic)) throw new Error('Missing yield actor')
	const implementations = { yieldControl: logic }
	const machine = setup<{}, { type: 'CONTINUE' } | { type: 'CANCEL' }, typeof implementations>({
		actors: implementations
	}).createMachine({
		initial: 'yielding',
		context: {},
		states: {
			yielding: {
				invoke: { src: 'yieldControl' },
				on: {
					CONTINUE: {
						target: 'closed',
						actions: () => {
							events.push('CONTINUE')
							continued.resolve()
						}
					},
					CANCEL: 'closed'
				}
			},
			closed: { type: 'final' }
		}
	})
	const actor = createActor(machine).start()
	actors.push(actor)
	return { actor, events, continued: continued.promise, firstClose, secondClose }
}
it('yields through a real MessageChannel without scheduling a timer and closes both ports', async () => {
	const timers = vi.spyOn(globalThis, 'setTimeout')
	const f = startYield()
	expect(f.events).toEqual([])
	await f.continued
	expect(f.events).toEqual(['CONTINUE'])
	expect(f.actor.getSnapshot().status).toBe('done')
	expect(f.firstClose).toHaveBeenCalledOnce()
	expect(f.secondClose).toHaveBeenCalledOnce()
	expect(timers).not.toHaveBeenCalled()
})
it('cancellation closes the channel before a queued continuation can be delivered', async () => {
	const f = startYield()
	f.actor.send({ type: 'CANCEL' })
	await setImmediate()
	expect(f.events).toEqual([])
	expect(f.firstClose).toHaveBeenCalledOnce()
	expect(f.secondClose).toHaveBeenCalledOnce()
})

it('the real snapshot leaf acquires no tracing resource even when its database call fails', async () => {
	const traced = vi.fn()
	const work: OperationWork = {
		command: { type: 'SYNC' },
		current: connection,
		scope: { ownerId: id(1), organizationId: id(2), connectionId: connection.id },
		attemptAt: new Date(),
		trace: {
			id: 'snapshot',
			log: vi.fn(),
			failed: vi.fn(),
			step: async (_stage, effect) => {
				traced()
				return effect()
			}
		}
	}
	const logic = createAccountImportMachine(dependencies()).implementations.actors?.existing
	if (!logic || !('getInitialSnapshot' in logic)) throw new Error('Missing snapshot actor')
	// The fixture has no DB implementation, so this exercises the production leaf's error path.
	const actor = createActor(logic, { input: { organizationId: id(2), accountId: id(4), work } })
	actors.push(actor)
	const result = toPromise(actor)
	actor.start()
	await expect(result).rejects.toBeInstanceOf(Error)
	expect(traced).not.toHaveBeenCalled()
})
