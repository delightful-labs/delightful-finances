import { byteView, decode, encode } from './passkey-bytes.js'
import type { WebAuthnCapability } from './webauthn-capability.js'
const random = () => crypto.getRandomValues(new Uint8Array(32))
function credentialId(credential: PublicKeyCredential) {
	const bytes = byteView(credential.rawId)
	if (!bytes.byteLength || bytes.byteLength > 3072) throw new Error('passkey-unavailable')
	return encode(bytes)
}
/** Browser credential primitives only. Finance cryptography stays with its owner. */
export const browserWebAuthn: WebAuthnCapability = {
	async create(input, signal) {
		signal.throwIfAborted()
		if (!globalThis.isSecureContext || !globalThis.PublicKeyCredential)
			throw new Error('passkey-unavailable')
		const created = await navigator.credentials.create({
			signal,
			publicKey: {
				challenge: random(),
				rp: { name: input.appName },
				user: {
					id: new TextEncoder().encode(input.ownerId),
					name: input.ownerId,
					displayName: input.appName
				},
				pubKeyCredParams: [
					{ type: 'public-key', alg: -7 },
					{ type: 'public-key', alg: -257 }
				],
				authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
				attestation: 'none',
				extensions: { prf: {} }
			}
		})
		signal.throwIfAborted()
		if (!(created instanceof PublicKeyCredential)) throw new Error('passkey-unavailable')
		return {
			credentialId: credentialId(created),
			prfEnabled: created.getClientExtensionResults().prf?.enabled === true
		}
	},
	async assert(input, signal) {
		signal.throwIfAborted()
		const credential = await navigator.credentials.get({
			signal,
			publicKey: {
				challenge: random(),
				allowCredentials: [{ type: 'public-key', id: decode(input.credentialId) }],
				userVerification: 'required',
				extensions: { prf: { eval: { first: decode(input.prfSalt) } } }
			}
		})
		const output =
			credential instanceof PublicKeyCredential
				? credential.getClientExtensionResults().prf?.results?.first
				: undefined
		if (!output) throw new Error('passkey-unavailable')
		const bytes = byteView(output)
		try {
			signal.throwIfAborted()
			if (
				!(credential instanceof PublicKeyCredential) ||
				credentialId(credential) !== input.credentialId ||
				bytes.byteLength !== 32
			)
				throw new Error('passkey-unavailable')
			return new Uint8Array(bytes)
		} finally {
			bytes.fill(0)
		}
	}
}
