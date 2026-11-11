import type { WebAuthnCapability } from '../../integrations/webauthn-capability.js'
import { hostScopeSchema, MAX_HOST_REQUESTS } from './host-protocol.js'
import {
	WEBAUTHN_PROTOCOL_VERSION,
	webAuthnRequestSchema,
	webAuthnReplySchema,
	type WebAuthnReply
} from './webauthn-protocol.js'

type Command =
	| { type: 'WEBAUTHN_CREATE'; ownerId: string; appName: string }
	| { type: 'WEBAUTHN_ASSERT'; credentialId: string; prfSalt: string }
type Pending = {
	sequence: number
	type: Command['type']
	signal: AbortSignal
	cancel: () => void
	resolve: (reply: WebAuthnReply) => void
	reject: (error: Error) => void
}
/** Private PRF transport; received secrets are never included in public views. */
export function createWorkerWebAuthn(port: MessagePort, scope: string) {
	hostScopeSchema.parse(scope)
	let sequence = 0
	let closed = false
	const pending = new Map<string, Pending>()
	const unavailable = () => new Error('passkey-unavailable')
	function receive(event: MessageEvent<unknown>) {
		if (closed || event.ports.length) return
		const decoded = webAuthnReplySchema.safeParse(event.data)
		if (!decoded.success) return
		const reply = decoded.data
		const call = reply.scope === scope ? pending.get(reply.requestId) : undefined
		if (!call || call.sequence !== reply.sequence) {
			if (reply.type === 'WEBAUTHN_ASSERTED') reply.bytes.fill(0)
			return
		}
		pending.delete(reply.requestId)
		call.signal.removeEventListener('abort', call.cancel)
		const matched =
			(call.type === 'WEBAUTHN_CREATE' && reply.type === 'WEBAUTHN_CREATED') ||
			(call.type === 'WEBAUTHN_ASSERT' && reply.type === 'WEBAUTHN_ASSERTED')
		if (call.signal.aborted || !matched) {
			if (reply.type === 'WEBAUTHN_ASSERTED') reply.bytes.fill(0)
			call.reject(call.signal.aborted ? new DOMException('Aborted', 'AbortError') : unavailable())
			return
		}
		call.resolve(reply)
	}
	function request(command: Command, signal: AbortSignal) {
		return new Promise<WebAuthnReply>((resolve, reject) => {
			if (closed || signal.aborted || pending.size >= MAX_HOST_REQUESTS) {
				reject(signal.aborted ? new DOMException('Aborted', 'AbortError') : unavailable())
				return
			}
			const decoded = webAuthnRequestSchema.safeParse({
				...command,
				version: WEBAUTHN_PROTOCOL_VERSION,
				scope,
				requestId: crypto.randomUUID(),
				sequence: sequence + 1
			})
			if (!decoded.success) {
				reject(unavailable())
				return
			}
			const message = decoded.data
			const cancel = () => {
				try {
					port.postMessage({
						type: 'WEBAUTHN_CANCEL',
						version: WEBAUTHN_PROTOCOL_VERSION,
						scope,
						requestId: message.requestId
					})
				} catch {
					close()
				}
			}
			pending.set(message.requestId, {
				sequence: message.sequence,
				type: message.type,
				signal,
				cancel,
				resolve,
				reject
			})
			signal.addEventListener('abort', cancel, { once: true })
			try {
				port.postMessage(message)
				sequence = message.sequence
			} catch {
				close()
			}
		})
	}
	function close() {
		if (closed) return
		closed = true
		port.removeEventListener('message', receive)
		for (const call of pending.values()) {
			call.signal.removeEventListener('abort', call.cancel)
			call.cancel()
			call.reject(unavailable())
		}
		pending.clear()
	}
	port.addEventListener('message', receive)
	port.start()
	const capability: WebAuthnCapability = {
		async create(input, signal) {
			const reply = await request({ type: 'WEBAUTHN_CREATE', ...input }, signal)
			if (reply.type !== 'WEBAUTHN_CREATED') throw unavailable()
			return { credentialId: reply.credentialId, prfEnabled: reply.prfEnabled }
		},
		async assert(input, signal) {
			const reply = await request({ type: 'WEBAUTHN_ASSERT', ...input }, signal)
			if (reply.type !== 'WEBAUTHN_ASSERTED') throw unavailable()
			return reply.bytes
		}
	}
	return { capability, close }
}
