import { createWorkerWebAuthn } from './worker-webauthn.js'
import {
	FINANCE_RUNTIME_PROTOCOL_VERSION,
	nativeReplySchema,
	nativeRequestSchema
} from './application-protocol.js'
import {
	HOST_REQUEST_TIMEOUT_MS,
	MAX_HOST_REQUESTS,
	WorkerHostError,
	hostScopeSchema
} from './host-protocol.js'

type Pending = {
	sequence: number
	resolve: () => void
	reject: (error: Error) => void
	timer: ReturnType<typeof setTimeout>
}
type NativeCommand =
	| {
			type: 'NAVIGATE'
			destination: string
			expectedHref: string
			expectedRouteSequence: number
			replace: boolean
	  }
	| { type: 'RELOAD' }
/** Correlated private native calls; never carries an application snapshot. */
export function createNativeCapabilities(port: MessagePort, scope: string, onFailure: () => void) {
	hostScopeSchema.parse(scope)
	const webAuthn = createWorkerWebAuthn(port, scope)
	let sequence = 0
	let closed = false
	const pending = new Map<string, Pending>()
	function close() {
		if (closed) return
		closed = true
		webAuthn.close()
		port.removeEventListener('message', receive)
		port.removeEventListener('messageerror', fail)
		port.close()
		for (const call of pending.values()) {
			clearTimeout(call.timer)
			call.reject(new WorkerHostError('closed', 'not-issued'))
		}
		pending.clear()
	}
	function fail() {
		if (closed) return
		close()
		onFailure()
	}
	function receive(event: MessageEvent<unknown>) {
		for (const transfer of event.ports) transfer.close()
		if (closed || event.ports.length) return
		const decoded = nativeReplySchema.safeParse(event.data)
		if (!decoded.success || decoded.data.scope !== scope) return
		const receipt = decoded.data,
			call = pending.get(receipt.requestId)
		if (!call || receipt.sequence !== call.sequence) return
		clearTimeout(call.timer)
		pending.delete(receipt.requestId)
		if (receipt.outcome === 'succeeded') call.resolve()
		else call.reject(new WorkerHostError('unavailable', 'not-issued'))
	}
	function request(command: NativeCommand) {
		return new Promise<void>((resolve, reject) => {
			if (closed || pending.size >= MAX_HOST_REQUESTS) {
				reject(new WorkerHostError('unavailable', 'not-issued'))
				return
			}
			const decoded = nativeRequestSchema.safeParse({
				...command,
				version: FINANCE_RUNTIME_PROTOCOL_VERSION,
				scope,
				requestId: crypto.randomUUID(),
				sequence: sequence + 1
			})
			if (!decoded.success) {
				reject(new WorkerHostError('rejected', 'not-issued'))
				return
			}
			const message = decoded.data
			pending.set(message.requestId, {
				sequence: message.sequence,
				resolve,
				reject,
				timer: setTimeout(fail, HOST_REQUEST_TIMEOUT_MS)
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
	return {
		webAuthn: webAuthn.capability,
		navigate: (
			destination: string,
			expectedHref: string,
			replace = false,
			expectedRouteSequence = 0
		) => request({ type: 'NAVIGATE', destination, expectedHref, expectedRouteSequence, replace }),
		reload: () => request({ type: 'RELOAD' }),
		close
	}
}
