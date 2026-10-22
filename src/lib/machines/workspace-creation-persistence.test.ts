import { describe, expect, it } from 'vitest'
import { waitFor } from 'xstate'
import { ReadTier } from 'jazz-tools'
import { attempt, creationFixture, workspace } from './workspace-creation.fixture.js'

describe('workspace persistence composition', () => {
	it('hydrates the scope before opening a transaction and returns the child outcome', async () => {
		const f = creationFixture()
		const hydrated = Promise.withResolvers<never[]>()
		f.hydrate.mockReturnValue(hydrated.promise)
		const actor = f.persistence()
		await waitFor(actor, (s) => s.matches('hydrating'))
		expect(f.beginTransaction).not.toHaveBeenCalled()
		expect(f.hydrate).toHaveBeenCalledTimes(4)
		expect(
			f.hydrate.mock.calls.every((call) => call[1]?.tier === ReadTier.LocalFirstUnlessEmpty)
		).toBe(true)
		hydrated.resolve([])
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'succeeded', settlement: 'locallyPersisted', workspace })
	})
	it('rejects blank names before reading or opening resources', async () => {
		const f = creationFixture()
		const done = await waitFor(
			f.persistence({ ...attempt, workspace: { ...attempt.workspace, name: ' ' } }),
			(s) => s.status === 'done'
		)
		expect(done.output).toMatchObject({ outcome: 'failed', settlement: 'notStarted' })
		expect(f.hydrate).not.toHaveBeenCalled()
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('does not start creation from failed hydration', async () => {
		const f = creationFixture()
		const error = new Error('read failed')
		f.hydrate.mockRejectedValue(error)
		const done = await waitFor(f.persistence(), (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'failed', settlement: 'notStarted', error })
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('ignores late hydration after cancellation', async () => {
		const f = creationFixture()
		const hydrated = Promise.withResolvers<never[]>()
		f.hydrate.mockReturnValue(hydrated.promise)
		const actor = f.persistence()
		await waitFor(actor, (s) => s.matches('hydrating'))
		actor.send({ type: 'CANCEL' })
		hydrated.resolve([])
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'cancelled', settlement: 'notStarted' })
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('forwards shutdown to the child and waits for local persistence', async () => {
		const f = creationFixture()
		const pending = Promise.withResolvers<void>()
		const started = Promise.withResolvers<void>()
		f.wait.mockImplementation(() => {
			started.resolve()
			return pending.promise
		})
		const actor = f.persistence()
		await started.promise
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().status).toBe('active')
		pending.resolve()
		const done = await waitFor(actor, (s) => s.status === 'done')
		expect(done.output).toEqual({ outcome: 'closed', settlement: 'locallyPersisted' })
	})
})
