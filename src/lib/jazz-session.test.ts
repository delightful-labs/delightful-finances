import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	createJazzSession,
	type JazzClient,
	type JazzSession,
	type JazzSessionConfig
} from 'jazz-tools/svelte'

vi.mock('jazz-tools/svelte', () => ({ createJazzSession: vi.fn() }))

const config = {
	appId: 'test-app',
	serverUrl: 'http://localhost:1234',
	initial: 'local-first'
} satisfies JazzSessionConfig
function sessionStub(): JazzSession<JazzClient> {
	return {
		getSnapshot: () => ({ status: 'ready' }),
		subscribe: () => () => {},
		createLocalFirst: vi.fn(async () => {}),
		restoreLocalFirst: vi.fn(async () => {}),
		becomeBackend: vi.fn(async () => {}),
		registerJWT: vi.fn(async () => {}),
		loginJWT: vi.fn(async () => {}),
		loginOrRegisterJWT: vi.fn(async () => {}),
		linkJWT: vi.fn(async () => {}),
		logout: vi.fn(async () => {}),
		retry: vi.fn(async () => {}),
		close: vi.fn(async () => {})
	}
}

beforeEach(() => {
	vi.resetModules()
	vi.mocked(createJazzSession).mockReset()
})

describe('shared session initialization', () => {
	it('deduplicates simultaneous startup calls and caches the successful owner', async () => {
		const owner = sessionStub()
		const pending = Promise.withResolvers<JazzSession<JazzClient>>()
		vi.mocked(createJazzSession).mockReturnValueOnce(pending.promise)
		const { getOrCreateJazzSession, getCurrentJazzSession } = await import('./jazz-session.js')
		const first = getOrCreateJazzSession(config)
		const second = getOrCreateJazzSession(config)
		expect(first).toBe(second)
		expect(getCurrentJazzSession()).toBeUndefined()
		pending.resolve(owner)
		await expect(first).resolves.toBe(owner)
		await expect(getOrCreateJazzSession(config)).resolves.toBe(owner)
		expect(getCurrentJazzSession()).toBe(owner)
		expect(createJazzSession).toHaveBeenCalledExactlyOnceWith(config)
	})

	it('clears failed startup attempts so repeated retries can recover', async () => {
		const owner = sessionStub()
		const failure = new Error('Network unavailable')
		vi.mocked(createJazzSession)
			.mockRejectedValueOnce(failure)
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(owner)
		const { getOrCreateJazzSession, getCurrentJazzSession } = await import('./jazz-session.js')
		await expect(getOrCreateJazzSession(config)).rejects.toBe(failure)
		expect(getCurrentJazzSession()).toBeUndefined()
		await expect(getOrCreateJazzSession(config)).rejects.toBe(failure)
		expect(getCurrentJazzSession()).toBeUndefined()
		await expect(getOrCreateJazzSession(config)).resolves.toBe(owner)
		expect(createJazzSession).toHaveBeenCalledTimes(3)
	})
})
