import { serveWindowHost } from '../../src/lib/runtime/worker/window-host.js'
import { serveWindowAccountLocks } from '../../src/lib/runtime/worker/window-account-locks.js'

export function createLeaseHarness() {
	let owner:
		| {
				worker: Worker
				data: MessageChannel
				host: ReturnType<typeof serveWindowAccountLocks>
				closeData: () => void
				queued: unknown[]
				key: string
		  }
		| undefined
	const reports: string[] = []
	return {
		reports,
		start(key: string, value: string, queueWrites = false) {
			if (owner) throw new Error('Harness already owns a worker')
			const scope = crypto.randomUUID()
			const data = new MessageChannel()
			const locks = new MessageChannel()
			const binding = { key, earlierSuffix: ':dev', earlierPathname: undefined }
			const host = serveWindowAccountLocks(locks.port2, scope, binding, navigator.locks)
			const queued: unknown[] = []
			const holdWrite = (event: MessageEvent<unknown>) => {
				// Hold a real worker-issued write at the Window boundary so termination
				// and competing-tab lock acquisition cannot be hidden by event timing.
				if (
					typeof event.data === 'object' &&
					event.data !== null &&
					'type' in event.data &&
					event.data.type === 'WRITE_ACCOUNT'
				) {
					event.stopImmediatePropagation()
					queued.push(event.data)
					reports.push('QUEUED')
				}
			}
			if (queueWrites) data.port2.addEventListener('message', holdWrite)
			const stopHost = serveWindowHost(
				data.port2,
				{
					scope,
					accountStorageKey: key,
					broker: {
						url: new URL('/broker.js', location.href).href,
						baseName: 'jazz-runtime:lease-test'
					}
				},
				{
					origin: location.origin,
					storage: localStorage,
					accountLocks: host,
					openBroker: () => {
						throw new Error('unused')
					}
				}
			)
			const closeData = () => {
				stopHost()
				data.port2.removeEventListener('message', holdWrite)
			}
			const worker = new Worker(new URL('./lease.worker.ts', import.meta.url), { type: 'module' })
			worker.addEventListener('message', (event: MessageEvent<unknown>) => {
				if (
					typeof event.data === 'object' &&
					event.data !== null &&
					'type' in event.data &&
					typeof event.data.type === 'string'
				)
					reports.push(event.data.type)
			})
			worker.addEventListener('error', () => reports.push('WORKER_ERROR'))
			owner = { worker, data, host, closeData, queued, key }
			worker.postMessage(
				{ type: 'START', scope, key, value, data: data.port1, locks: locks.port1 },
				[data.port1, locks.port1]
			)
		},
		terminate() {
			owner?.worker.terminate()
		},
		async closeHost() {
			if (!owner) return
			owner.closeData()
			await owner.host.close()
			owner.host.dispose()
		},
		replayQueued() {
			for (const data of owner?.queued ?? [])
				owner?.data.port2.dispatchEvent(new MessageEvent('message', { data }))
		},
		read() {
			return owner ? localStorage.getItem(owner.key) : null
		},
		async locks() {
			return navigator.locks.query()
		},
		release() {
			owner?.worker.postMessage({ type: 'RELEASE' })
		}
	}
}
declare global {
	interface Window {
		leaseHarness: ReturnType<typeof createLeaseHarness>
	}
}
window.leaseHarness = createLeaseHarness()
