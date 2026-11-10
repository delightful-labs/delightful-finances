export type WebAuthnCapability = {
	create: (
		input: { ownerId: string; appName: string },
		signal: AbortSignal
	) => Promise<{ credentialId: string; prfEnabled: boolean }>
	assert: (
		input: { credentialId: string; prfSalt: string },
		signal: AbortSignal
	) => Promise<Uint8Array<ArrayBuffer>>
}
let current: { capability: WebAuthnCapability } | undefined
/** Realm-local primitive binding; cleanup cannot clear a replacement binding. */
export function bindWebAuthn(capability: WebAuthnCapability) {
	const binding = { capability }
	current = binding
	return () => {
		if (current === binding) current = undefined
	}
}
export function webAuthn() {
	if (!current) throw new Error('passkey-unavailable')
	return current.capability
}
