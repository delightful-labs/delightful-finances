import {
	ACCOUNT_LOCK_PROTOCOL_VERSION,
	MAX_ACCOUNT_LOCKS,
	accountLockReplySchema,
	type AccountLockRequest,
	type AccountLockCommand,
	type AccountStorageLeases,
	type AccountLocks
} from './account-lock-protocol.js'
import { HOST_REQUEST_TIMEOUT_MS, WorkerHostError, hostScopeSchema } from './host-protocol.js'

type Pending = {
	leaseId: string
	sequence: number
	expected: 'ACQUIRED' | 'RELEASED'
	resolve: () => void
	reject: (error: Error) => void
	timer: ReturnType<typeof setTimeout>
}

/** Private native-lock adapter. Callback cleanup requests RELEASE even when
 * acquisition was aborted; only the Window native receipt confirms release. */
export function createWorkerAccountLocks(
	port: MessagePort,
	scope: string,
	primaryKey: string,
	onFailure: () => void
) {
	hostScopeSchema.parse(scope)
	const pending = new Map<string, Pending>()
	let disposed = false
	let active = 0
	let sequence = 0
	const held = new Map<string, string>()
	function fail() {
		if (disposed) return
		dispose()
		onFailure()
	}
	function dispose() {
		if (disposed) return
		disposed = true
		port.removeEventListener('message', receive)
		port.removeEventListener('messageerror', fail)
		port.close()
		for (const call of pending.values()) {
			clearTimeout(call.timer)
			call.reject(new WorkerHostError('closed', 'unknown'))
		}
		pending.clear()
	}
	function receive(event: MessageEvent<unknown>) {
		for (const transferred of event.ports) transferred.close()
		if (event.ports.length || disposed) return
		const decoded = accountLockReplySchema.safeParse(event.data)
		if (!decoded.success || decoded.data.scope !== scope) return
		const reply = decoded.data
		const call = pending.get(reply.requestId)
		if (!call || call.leaseId !== reply.leaseId || call.sequence !== reply.sequence) return
		clearTimeout(call.timer)
		pending.delete(reply.requestId)
		if (reply.type !== call.expected) call.reject(new WorkerHostError('unavailable', 'unknown'))
		else call.resolve()
	}
	function request(command: AccountLockCommand, expected: Pending['expected']) {
		return new Promise<void>((resolve, reject) => {
			if (disposed || pending.size >= MAX_ACCOUNT_LOCKS * 2) {
				reject(new WorkerHostError('closed', 'unknown'))
				return
			}
			const timer = setTimeout(fail, HOST_REQUEST_TIMEOUT_MS)
			const message = { ...command, sequence: sequence + 1 }
			pending.set(command.requestId, {
				leaseId: command.leaseId,
				sequence: message.sequence,
				expected,
				resolve,
				reject,
				timer
			})
			try {
				port.postMessage(message)
				sequence = message.sequence
			} catch {
				fail()
			}
		})
	}
	port.addEventListener('message', receive)
	port.addEventListener('messageerror', fail)
	port.start()
	const locks: AccountLocks = {
		async request(key, { signal }, callback) {
			signal.throwIfAborted()
			if (active >= MAX_ACCOUNT_LOCKS) throw new WorkerHostError('overloaded', 'not-issued')
			active++
			const correlation = {
				version: ACCOUNT_LOCK_PROTOCOL_VERSION,
				scope,
				leaseId: crypto.randomUUID()
			} satisfies Pick<AccountLockRequest, 'version' | 'scope' | 'leaseId'>
			let releasing: Promise<void> | undefined
			let holding = false
			const release = () => {
				releasing ??= request(
					{ ...correlation, requestId: crypto.randomUUID(), type: 'RELEASE' },
					'RELEASED'
				)
				// Abort callbacks cannot await. The finally block observes this promise.
				void releasing.catch(() => {})
				return releasing
			}
			const acquired = request(
				{ ...correlation, requestId: crypto.randomUUID(), type: 'ACQUIRE', key },
				'ACQUIRED'
			)
			// Like native Web Locks, abort cancels acquisition; it cannot release a
			// granted lock while its callback still owns work.
			const abort = () => {
				if (!holding) void release()
			}
			signal.addEventListener('abort', abort, { once: true })
			try {
				await acquired
				signal.throwIfAborted()
				holding = true
				held.set(key, correlation.leaseId)
				await callback()
			} finally {
				if (held.get(key) === correlation.leaseId) held.delete(key)
				signal.removeEventListener('abort', abort)
				try {
					await release()
				} finally {
					active--
				}
			}
		}
	}
	const storageLeases: AccountStorageLeases = {
		primary: () => held.get(primaryKey),
		earlier: (key) => held.get(key)
	}
	return { locks, storageLeases, dispose }
}
