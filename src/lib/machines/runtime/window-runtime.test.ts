import { afterEach, expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import {
	windowRuntimeMachine,
	type WindowRuntimeConnection,
	type WindowRuntimeReport
} from './window-runtime.js'

class Connection implements WindowRuntimeConnection {
	observers = new Set<(report: WindowRuntimeReport) => void>()
	start = vi.fn(() => {})
	requestShutdown = vi.fn(() => {})
	closeData = vi.fn(() => {})
	drainNativeLocks = vi.fn(async () => {})
	dispose = vi.fn(() => {})
	subscribe = (publish: (report: WindowRuntimeReport) => void) => {
		this.observers.add(publish)
		return () => {
			this.observers.delete(publish)
		}
	}
	emit(report: WindowRuntimeReport) {
		for (const observer of this.observers) observer(report)
	}
}
const roots = new Set<ReturnType<typeof createActor<typeof windowRuntimeMachine>>>()
afterEach(() => {
	for (const root of roots) root.stop()
	roots.clear()
})
function fixture() {
	const connection = new Connection()
	const root = createActor(windowRuntimeMachine, { input: connection })
	roots.add(root)
	return { root, connection }
}
it('requires worker closure and actual native lock drain before termination', async () => {
	const f = fixture(),
		drain = Promise.withResolvers<void>()
	f.connection.drainNativeLocks.mockImplementation(() => drain.promise)
	f.root.start()
	await waitFor(f.root, (snapshot) => snapshot.matches('running'))
	f.root.send({ type: 'CLOSE' })
	await vi.waitFor(() => expect(f.connection.requestShutdown).toHaveBeenCalledOnce())
	expect(f.connection.dispose).not.toHaveBeenCalled()
	f.connection.emit({ type: 'CLOSED' })
	await waitFor(f.root, (snapshot) => snapshot.matches('drainingLocks'))
	expect(f.connection.closeData).toHaveBeenCalledOnce()
	expect(f.connection.dispose).not.toHaveBeenCalled()
	drain.resolve()
	await toPromise(f.root)
	expect(f.connection.dispose).toHaveBeenCalledOnce()
})
it('does not terminate on worker error and can consume a late real close receipt', async () => {
	const f = fixture()
	f.root.start()
	await waitFor(f.root, (snapshot) => snapshot.matches('running'))
	f.connection.emit({ type: 'FAILED' })
	await waitFor(f.root, (snapshot) => snapshot.matches('releaseBlocked'))
	expect(f.connection.closeData).toHaveBeenCalledOnce()
	expect(f.connection.dispose).not.toHaveBeenCalled()
	f.connection.emit({ type: 'CLOSED' })
	await toPromise(f.root)
	expect(f.connection.dispose).toHaveBeenCalledOnce()
})
it('retains native resources after a failed drain rather than claiming closure', async () => {
	const f = fixture()
	f.connection.drainNativeLocks.mockRejectedValue(new Error('native lease retained'))
	f.root.start()
	await waitFor(f.root, (snapshot) => snapshot.matches('running'))
	f.connection.emit({ type: 'CLOSED' })
	await waitFor(f.root, (snapshot) => snapshot.matches('releaseBlocked'))
	expect(f.connection.dispose).not.toHaveBeenCalled()
	expect(f.root.getSnapshot().status).toBe('active')
})
it('does not cancel bootstrap ownership when close is requested during startup', async () => {
	const f = fixture(),
		opening = Promise.withResolvers<void>()
	f.connection.start.mockImplementation(() => opening.promise)
	f.root.start()
	f.root.send({ type: 'CLOSE' })
	expect(f.connection.requestShutdown).not.toHaveBeenCalled()
	opening.resolve()
	await waitFor(f.root, (snapshot) => snapshot.matches('draining'))
	await vi.waitFor(() => expect(f.connection.requestShutdown).toHaveBeenCalledOnce())
	f.connection.emit({ type: 'CLOSED' })
	await toPromise(f.root)
	expect(f.connection.dispose).toHaveBeenCalledOnce()
})
