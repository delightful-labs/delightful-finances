import { nativeRequestSchema, type NativeRequest } from './application-protocol.js'
import { MAX_HOST_REQUESTS, hostScopeSchema } from './host-protocol.js'
import { serveWebAuthn } from './window-webauthn.js'
type Navigation = {
	readHref: () => string
	readRouteSequence: () => number
	navigate: (destination: string, replace: boolean) => Promise<void>
	reload: () => void
}
/** Window primitives only. The worker chooses the operation and owns all policy. */
export function serveNativeCapabilities(port: MessagePort, scope: string, navigation: Navigation) {
	hostScopeSchema.parse(scope)
	const closeWebAuthn = serveWebAuthn(port, scope)
	let sequence = 0
	let closed = false
	let outstanding = 0
	function reply(request: NativeRequest, outcome: 'succeeded' | 'unavailable' | 'obsolete') {
		if (closed) return
		const { version, scope, requestId, sequence } = request
		try {
			port.postMessage({ version, scope, requestId, sequence, type: 'NATIVE_SETTLED', outcome })
		} catch {
			close()
		}
	}
	function receive(event: MessageEvent<unknown>) {
		for (const transfer of event.ports) transfer.close()
		if (closed || event.ports.length) return
		const decoded = nativeRequestSchema.safeParse(event.data)
		if (!decoded.success || decoded.data.scope !== scope) return
		const request = decoded.data
		if (request.sequence !== sequence + 1 || outstanding >= MAX_HOST_REQUESTS) {
			reply(request, 'unavailable')
			return
		}
		sequence = request.sequence
		outstanding++
		// No browser action starts until this selected native leaf executes.
		void Promise.resolve()
			.then<'obsolete' | void>(() => {
				if (closed) return
				if (request.type === 'RELOAD') {
					navigation.reload()
					return
				}
				if (
					navigation.readHref() !== request.expectedHref ||
					navigation.readRouteSequence() !== request.expectedRouteSequence
				) {
					reply(request, 'obsolete')
					return 'obsolete'
				}
				return navigation.navigate(request.destination, request.replace)
			})
			.then(
				(result) => {
					if (result !== 'obsolete') reply(request, 'succeeded')
				},
				() => reply(request, 'unavailable')
			)
			.finally(() => {
				outstanding--
			})
	}
	function close() {
		if (closed) return
		closed = true
		closeWebAuthn()
		port.removeEventListener('message', receive)
		port.close()
	}
	port.addEventListener('message', receive)
	port.start()
	return close
}
