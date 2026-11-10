import { afterEach, expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import type { JazzClient, JazzSession } from 'jazz-tools/client'
import { createJazzSessionReadinessAdapter } from 'delightful-local-first/backend/jazz/session-readiness'
import {
	financeWorkerRuntimeMachine,
	type FinanceWorkerRuntimeInput
} from './finance-worker-runtime.js'
import { createApplicationReadinessMachine } from './application-readiness.js'

class Session implements JazzSession<JazzClient> {
	listeners = new Set<() => void>()
	close = vi.fn(async () => {})
	createLocalFirst = vi.fn(async () => {})
	restoreLocalFirst = vi.fn(async (_secret: string) => {})
	loginWithBackend = vi.fn(async () => {})
	linkWithBackend = vi.fn(async () => {})
	logout = vi.fn(async () => {})
	retry = vi.fn(async () => {})
	getSnapshot(): ReturnType<JazzSession<JazzClient>['getSnapshot']> {
		return { status: 'signed-out' }
	}
	subscribe(listener: () => void) {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}
}
const roots = new Set<ReturnType<typeof createActor<typeof financeWorkerRuntimeMachine>>>()
afterEach(() => {
	// Test teardown is not production release. Failed-release cases intentionally
	// retain their resource owners; all substituted resources here are disposable.
	for (const root of roots) root.stop()
	roots.clear()
})
function fixture() {
	const session = new Session()
	const opening = Promise.withResolvers<JazzSession<JazzClient>>()
	const trace: string[] = []
	session.close.mockImplementation(async () => {
		trace.push('sdk.close')
	})
	const closeHost = vi.fn(async () => {
		trace.push('host.close')
	})
	const dispose = vi.fn(() => {
		trace.push('dispose')
	})
	const root = createActor(financeWorkerRuntimeMachine, {
		input: {
			accounts: {
				binding: { key: crypto.randomUUID(), earlierSuffix: ':dev', earlierPathname: undefined },
				locks: navigator.locks,
				storage: {
					scope: crypto.randomUUID(),
					readSnapshot: async () => ({ current: null, earlier: [] }),
					writePrimary: async () => {},
					readEarlier: async () => null,
					writeEarlier: async () => {},
					closeHostAndDrain: closeHost
				}
			},
			acquire: () => ({ binding: {}, capability: { open: () => opening.promise } }),
			application: () =>
				createApplicationReadinessMachine(undefined, undefined, createJazzSessionReadinessAdapter),
			closeHost,
			dispose
		} satisfies FinanceWorkerRuntimeInput
	}).start()
	roots.add(root)
	const acquisition = root.getSnapshot().context.acquisition
	const application = root.getSnapshot().context.application
	if (!acquisition || !application) throw new Error('Runtime did not create its owners')
	return { root, acquisition, application, opening, session, closeHost, dispose, trace }
}
it('retains a late SDK acquisition after shutdown and closes it before releasing the host', async () => {
	const f = fixture()
	await waitFor(f.acquisition, (snapshot) => snapshot.matches('opening'))
	f.root.send({ type: 'SHUTDOWN' })
	await waitFor(f.root, (snapshot) => snapshot.matches('awaitingAcquisition'))
	expect(f.closeHost).not.toHaveBeenCalled()
	expect(f.dispose).not.toHaveBeenCalled()
	f.opening.resolve(f.session)
	await toPromise(f.root)
	expect(f.trace).toEqual(['sdk.close', 'host.close', 'dispose'])
	expect(f.root.getSnapshot().context.session).toBeUndefined()
})
it('closes the application before SDK and host release after an ordinary startup', async () => {
	const f = fixture()
	f.opening.resolve(f.session)
	await waitFor(f.application, (snapshot) => snapshot.context.session === f.session)
	f.session.close.mockImplementation(async () => {
		expect(f.application.getSnapshot().status).toBe('done')
		f.trace.push('sdk.close')
	})
	f.root.send({ type: 'SHUTDOWN' })
	await toPromise(f.root)
	expect(f.trace).toEqual(['sdk.close', 'host.close', 'dispose'])
})
it('retains resources when SDK close fails and ignores repeated shutdown commands', async () => {
	const f = fixture()
	f.session.close.mockRejectedValue(new Error('SDK resource retained'))
	f.opening.resolve(f.session)
	await waitFor(f.application, (snapshot) => snapshot.context.session === f.session)
	f.root.send({ type: 'SHUTDOWN' })
	await waitFor(f.root, (snapshot) => snapshot.matches('releaseBlocked'))
	f.root.send({ type: 'SHUTDOWN' })
	expect(f.root.getSnapshot().status).toBe('active')
	expect(f.session.close).toHaveBeenCalledOnce()
	expect(f.closeHost).not.toHaveBeenCalled()
	expect(f.dispose).not.toHaveBeenCalled()
})
it('does not treat failed native drain as permission to dispose or terminate', async () => {
	const f = fixture()
	f.closeHost.mockRejectedValue(new Error('no native receipt'))
	f.opening.resolve(f.session)
	await waitFor(f.application, (snapshot) => snapshot.context.session === f.session)
	f.root.send({ type: 'SHUTDOWN' })
	await waitFor(f.root, (snapshot) => snapshot.matches('releaseBlocked'))
	expect(f.session.close).toHaveBeenCalledOnce()
	expect(f.dispose).not.toHaveBeenCalled()
})
it('does not admit recovery commands after shutdown closes admission', async () => {
	const f = fixture()
	f.opening.resolve(f.session)
	await waitFor(f.application, (snapshot) => snapshot.context.session === f.session)
	f.root.send({ type: 'SHUTDOWN' })
	f.root.send({
		type: 'COMMAND',
		command: { type: 'RECOVER', phrase: 'obsolete', origin: '/', destination: '/' }
	})
	await toPromise(f.root)
	expect(f.session.restoreLocalFirst).not.toHaveBeenCalled()
})
