import { isEarlierSelectionKey, type AccountStorageBinding } from './account-storage-namespace.js'
import {
	MAX_ACCOUNT_LOCKS,
	accountLockRequestSchema,
	type AccountLockReply,
	type AccountLockRequest
} from './account-lock-protocol.js'
import { hostScopeSchema } from './host-protocol.js'

type Lease = {
	key: string
	abort: AbortController
	release: () => void
	settled: Promise<void>
}

/** Native Window leases, independent of the requesting worker's lifetime.
 * The owner MUST close data-port admission before calling close(), and must
 * await close() before disposing this control port or replacing its runtime.
 * A dead worker cannot release these leases while its Window can still write. */
export function serveWindowAccountLocks(
	port: MessagePort,
	scope: string,
	binding: AccountStorageBinding,
	locks: Pick<LockManager, 'request'>
) {
	hostScopeSchema.parse(scope)
	binding = { ...binding }
	if (!binding.key || binding.key.length > 65_536) throw new Error('Invalid account lock binding')
	const leases = new Map<string, Lease>()
	const held = new Map<string, string>()
	let closed = false
	let sequence = 0
	let drained = false
	function reply(request: AccountLockRequest, type: AccountLockReply['type']) {
		const { version, scope, requestId, leaseId, sequence } = request
		try {
			port.postMessage({
				version,
				scope,
				requestId,
				leaseId,
				sequence,
				type
			} satisfies AccountLockReply)
		} catch {
			// Retain the lease. Port failure is not proof that Window stopped writing.
		}
	}
	function receive(event: MessageEvent<unknown>) {
		for (const transferred of event.ports) transferred.close()
		if (event.ports.length) return
		const decoded = accountLockRequestSchema.safeParse(event.data)
		if (!decoded.success || decoded.data.scope !== scope) return
		const request = decoded.data
		if (request.sequence !== sequence + 1) {
			reply(request, 'FAILED')
			return
		}
		sequence = request.sequence
		if (request.type === 'RELEASE') {
			const lease = leases.get(request.leaseId)
			if (!lease) {
				reply(request, 'FAILED')
				return
			}
			lease.abort.abort()
			lease.release()
			void lease.settled.then(() => {
				// The native request has actually settled; do not acknowledge at send time.
				if (leases.get(request.leaseId) === lease) leases.delete(request.leaseId)
				reply(request, 'RELEASED')
			})
			return
		}
		if (
			closed ||
			leases.has(request.leaseId) ||
			leases.size >= MAX_ACCOUNT_LOCKS ||
			[...leases.values()].some((lease) => lease.key === request.key) ||
			(request.key !== binding.key && !isEarlierSelectionKey(binding, request.key))
		) {
			reply(request, 'FAILED')
			return
		}
		const abort = new AbortController()
		const release = Promise.withResolvers<void>()
		const settled = Promise.withResolvers<void>()
		const lease: Lease = {
			key: request.key,
			abort,
			release: release.resolve,
			settled: settled.promise
		}
		leases.set(request.leaseId, lease)
		drained = false
		// This callback is a native resource lease, with no domain decisions or
		// storage operations. Release is owned by the explicit protocol above.
		try {
			void locks
				.request(request.key, { signal: abort.signal }, async () => {
					if (closed || abort.signal.aborted) return
					held.set(request.key, request.leaseId)
					reply(request, 'ACQUIRED')
					await release.promise
					held.delete(request.key)
				})
				.then(
					() => {
						settled.resolve()
						if (abort.signal.aborted || closed) reply(request, 'FAILED')
					},
					() => {
						held.delete(request.key)
						settled.resolve()
						reply(request, 'FAILED')
					}
				)
		} catch {
			settled.resolve()
			reply(request, 'FAILED')
		}
	}
	port.addEventListener('message', receive)
	port.start()
	return {
		owns: (key: string, leaseId?: string) =>
			!closed && held.has(key) && (leaseId === undefined || held.get(key) === leaseId),
		close() {
			closed = true
			for (const lease of leases.values()) {
				lease.abort.abort()
				lease.release()
			}
			return Promise.all([...leases.values()].map((lease) => lease.settled)).then(() => {
				drained = true
			})
		},
		dispose() {
			if (!closed || !drained) throw new Error('Account locks have not drained')
			port.removeEventListener('message', receive)
			port.close()
			leases.clear()
		}
	}
}
