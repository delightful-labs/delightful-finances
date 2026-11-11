import { browserWebAuthn } from '../../integrations/browser-webauthn.js'
import type { WebAuthnCapability } from '../../integrations/webauthn-capability.js'
import { hostScopeSchema } from './host-protocol.js'
import {
	WEBAUTHN_PROTOCOL_VERSION,
	webAuthnCancelSchema,
	webAuthnRequestSchema,
	type WebAuthnReply,
	type WebAuthnRequest
} from './webauthn-protocol.js'

/** Owns browser credential prompts. This module is never imported by the worker. */
export function serveWebAuthn(
	port: MessagePort,
	scope: string,
	capability: WebAuthnCapability = browserWebAuthn
) {
	hostScopeSchema.parse(scope)
	let sequence = 0
	let closed = false
	const pending = new Map<string, AbortController>()
	function post(reply: WebAuthnReply) {
		if (closed) {
			if (reply.type === 'WEBAUTHN_ASSERTED') reply.bytes.fill(0)
			return
		}
		try {
			port.postMessage(reply, reply.type === 'WEBAUTHN_ASSERTED' ? [reply.bytes.buffer] : [])
		} catch {
			if (reply.type === 'WEBAUTHN_ASSERTED' && reply.bytes.byteLength) reply.bytes.fill(0)
			close()
		}
	}
	function unavailable(request: WebAuthnRequest) {
		post({
			type: 'WEBAUTHN_UNAVAILABLE',
			version: WEBAUTHN_PROTOCOL_VERSION,
			scope,
			requestId: request.requestId,
			sequence: request.sequence
		})
	}
	function receive(event: MessageEvent<unknown>) {
		if (closed || event.ports.length) return
		const cancel = webAuthnCancelSchema.safeParse(event.data)
		if (cancel.success && cancel.data.scope === scope) {
			pending.get(cancel.data.requestId)?.abort()
			return
		}
		const decoded = webAuthnRequestSchema.safeParse(event.data)
		if (!decoded.success || decoded.data.scope !== scope) return
		const request = decoded.data
		if (request.sequence !== sequence + 1) return
		sequence = request.sequence
		// Browsers admit one credential prompt per document. Do not queue consent.
		if (pending.size) {
			unavailable(request)
			return
		}
		const controller = new AbortController()
		pending.set(request.requestId, controller)
		const correlation: Pick<WebAuthnRequest, 'version' | 'scope' | 'requestId' | 'sequence'> = {
			version: WEBAUTHN_PROTOCOL_VERSION,
			scope,
			requestId: request.requestId,
			sequence: request.sequence
		}
		const work =
			request.type === 'WEBAUTHN_CREATE'
				? () =>
						capability
							.create(request, controller.signal)
							.then((result) => post({ ...correlation, type: 'WEBAUTHN_CREATED', ...result }))
				: () =>
						capability.assert(request, controller.signal).then((bytes) => {
							if (
								controller.signal.aborted ||
								closed ||
								bytes.byteLength !== 32 ||
								bytes.byteOffset !== 0 ||
								bytes.buffer.byteLength !== 32
							) {
								bytes.fill(0)
								unavailable(request)
								return
							}
							post({ ...correlation, type: 'WEBAUTHN_ASSERTED', bytes })
						})
		void Promise.resolve()
			.then(() => {
				controller.signal.throwIfAborted()
				return work()
			})
			.catch(() => unavailable(request))
			.finally(() => pending.delete(request.requestId))
	}
	function close() {
		if (closed) return
		closed = true
		port.removeEventListener('message', receive)
		for (const controller of pending.values()) controller.abort()
	}
	port.addEventListener('message', receive)
	port.start()
	return close
}
