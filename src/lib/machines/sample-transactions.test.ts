import { createActor, waitFor } from 'xstate'
import { describe, expect, it } from 'vitest'
import { sampleTransactionsMachine } from './sample-transactions.js'

describe('sample transaction batches', () => {
	it('saves exactly 25 sequential entries and allows a new batch', async () => {
		const indices: number[] = []
		let active = 0
		let peak = 0
		const actor = createActor(sampleTransactionsMachine, {
			input: {
				create: async (index) => {
					active += 1
					peak = Math.max(peak, active)
					await Promise.resolve()
					indices.push(index)
					active -= 1
				}
			}
		}).start()
		actor.send({ type: 'ADD' })
		actor.send({ type: 'ADD' })
		await waitFor(actor, (snapshot) => snapshot.matches('complete'))
		expect(indices).toEqual(Array.from({ length: 25 }, (_, index) => index))
		expect(peak).toBe(1)
		actor.send({ type: 'ADD' })
		await waitFor(actor, (snapshot) => snapshot.matches('complete'))
		expect(indices).toHaveLength(50)
		expect(actor.getSnapshot().context.saved).toBe(25)
		actor.stop()
	})

	for (const failAt of [0, 4]) {
		it(`stops on failure after ${failAt} saves and retries with a new batch`, async () => {
			let fail = true
			const indices: number[] = []
			const actor = createActor(sampleTransactionsMachine, {
				input: {
					create: async (index) => {
						indices.push(index)
						if (fail && index === failAt) throw new Error('Write failed')
					}
				}
			}).start()
			actor.send({ type: 'ADD' })
			await waitFor(actor, (snapshot) => snapshot.matches(failAt ? 'partial' : 'failure'))
			expect(actor.getSnapshot().context.saved).toBe(failAt)
			expect(indices).toHaveLength(failAt + 1)
			fail = false
			actor.send({ type: 'ADD' })
			await waitFor(actor, (snapshot) => snapshot.matches('complete'))
			expect(indices.slice(failAt + 1)).toEqual(Array.from({ length: 25 }, (_, index) => index))
			actor.stop()
		})
	}

	it('does not start another write after cancellation, even if the issued write finishes', async () => {
		let finish: () => void = () => {}
		let writes = 0
		const actor = createActor(sampleTransactionsMachine, {
			input: {
				create: () => {
					writes += 1
					return new Promise<void>((resolve) => {
						finish = resolve
					})
				}
			}
		}).start()
		actor.send({ type: 'ADD' })
		actor.send({ type: 'CANCEL' })
		finish()
		await Promise.resolve()
		await Promise.resolve()
		expect(actor.getSnapshot().matches('cancelled')).toBe(true)
		expect(writes).toBe(1)
		actor.stop()
	})
})
