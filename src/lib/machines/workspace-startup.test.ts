import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import type { schema } from 'jazz-tools'
import { app } from '../schema.js'
import { createWorkspaceStartupMachine } from './workspace-startup.js'
import { creationFixture, profileId, userId, workspace } from './workspace-creation.fixture.js'

const secondUser = '77777777-7777-4777-8777-777777777777'
const thirdUser = '88888888-8888-4888-8888-888888888888'
const profile: schema.RowOf<typeof app.profiles> = {
	id: profileId,
	userId,
	initialWorkspaceId: workspace.id,
	displayName: null,
	avatarData: null,
	avatarMimeType: null
}
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const stop of cleanups.splice(0)) stop()
})
function fixture(initial: 'ready' | 'transitioning' = 'ready', legacy = false) {
	const f = creationFixture()
	const discover = vi.fn().mockResolvedValue([])
	function queue() {
		const pending = Promise.withResolvers<(typeof profile)[]>()
		discover.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(legacy ? [workspace] : [])
		return pending
	}
	const first = queue()
	const actor = createActor(
		createWorkspaceStartupMachine({
			...f.db,
			all: discover,
			getConfig: vi.fn().mockReturnValue({ serverUrl: 'https://unused.invalid' })
		}),
		{ input: { userId, status: initial } }
	).start()
	cleanups.push(() => actor.stop())
	return { ...f, actor, discover, first, queue }
}

describe('startup session ownership', () => {
	it('waits for a ready session before starting initialization', () => {
		const f = fixture('transitioning')
		expect(f.discover).not.toHaveBeenCalled()
		f.actor.send({ type: 'OBSERVED', source: { userId, status: 'ready' } })
		expect(f.discover).toHaveBeenCalledTimes(2)
	})
	it('does not restart initialization for ordinary observations of the same identity', async () => {
		const f = fixture()
		f.first.resolve([profile])
		await waitFor(f.actor, (s) => s.matches('ready'))
		f.actor.send({ type: 'OBSERVED', source: { userId, status: 'ready' } })
		expect(f.discover).toHaveBeenCalledTimes(2)
		expect(f.actor.getSnapshot().hasTag('workspace-ready')).toBe(true)
	})
	it('drains old initialization writes before using the latest replacement identity', async () => {
		const f = fixture('ready', true)
		f.one.mockResolvedValueOnce(workspace)
		const pendingWrite = Promise.withResolvers<void>()
		const started = Promise.withResolvers<void>()
		f.wait.mockImplementation(() => {
			started.resolve()
			return pendingWrite.promise
		})
		f.first.resolve([{ ...profile, initialWorkspaceId: null }])
		await started.promise
		const next = f.queue()
		f.actor.send({ type: 'OBSERVED', source: { userId: secondUser, status: 'ready' } })
		f.actor.send({ type: 'OBSERVED', source: { userId: thirdUser, status: 'ready' } })
		expect(f.actor.getSnapshot().matches({ initializing: 'replacing' })).toBe(true)
		expect(f.discover).toHaveBeenCalledTimes(2)
		pendingWrite.resolve()
		await vi.waitFor(() => expect(f.discover).toHaveBeenCalledTimes(4))
		expect(f.actor.getSnapshot().context.operationUserId).toBe(thirdUser)
		expect(f.actor.getSnapshot().hasTag('workspace-ready')).toBe(false)
		next.resolve([{ ...profile, userId: thirdUser }])
		await waitFor(f.actor, (s) => s.matches('ready'))
		expect(f.actor.getSnapshot().context.result).toEqual({ outcome: 'ready', profileId })
	})
	it('preserves shutdown over replacement, observations, retries, and late completion', async () => {
		const f = fixture('ready', true)
		f.one.mockResolvedValueOnce(workspace)
		const pendingWrite = Promise.withResolvers<void>()
		const started = Promise.withResolvers<void>()
		f.wait.mockImplementation(() => {
			started.resolve()
			return pendingWrite.promise
		})
		f.first.resolve([{ ...profile, initialWorkspaceId: null }])
		await started.promise
		f.actor.send({ type: 'OBSERVED', source: { userId: secondUser, status: 'ready' } })
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'OBSERVED', source: { userId: thirdUser, status: 'ready' } })
		f.actor.send({ type: 'RETRY' })
		expect(f.actor.getSnapshot().status).toBe('active')
		pendingWrite.resolve()
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.discover).toHaveBeenCalledTimes(2)
	})
	it('requires explicit retry after an initialization failure', async () => {
		const f = fixture()
		f.first.reject(new Error('read failed'))
		await waitFor(f.actor, (s) => s.hasTag('workspace-error'))
		f.actor.send({ type: 'OBSERVED', source: { userId, status: 'ready' } })
		expect(f.discover).toHaveBeenCalledTimes(2)
		const retry = f.queue()
		f.actor.send({ type: 'RETRY' })
		retry.resolve([profile])
		await waitFor(f.actor, (s) => s.hasTag('workspace-ready'))
		expect(f.discover).toHaveBeenCalledTimes(4)
	})
	it('cancels an outstanding read without starting a transaction', async () => {
		const f = fixture()
		f.actor.send({ type: 'SHUTDOWN' })
		f.first.resolve([profile])
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
})
