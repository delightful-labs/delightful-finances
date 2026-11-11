import { z } from 'zod'
import { hostScopeSchema } from './host-protocol.js'
export const WEBAUTHN_PROTOCOL_VERSION = 1
const base = z.object({
	version: z.literal(WEBAUTHN_PROTOCOL_VERSION),
	scope: hostScopeSchema,
	requestId: z.string().uuid(),
	sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
})
const encoded = z
	.string()
	.min(1)
	.max(4096)
	.regex(/^[A-Za-z0-9_-]+$/)
export const webAuthnRequestSchema = z.discriminatedUnion('type', [
	base
		.extend({
			type: z.literal('WEBAUTHN_CREATE'),
			ownerId: z.string().uuid(),
			appName: z.string().min(1).max(4096)
		})
		.strict(),
	base
		.extend({
			type: z.literal('WEBAUTHN_ASSERT'),
			credentialId: encoded,
			prfSalt: encoded.length(43)
		})
		.strict()
])
export const webAuthnCancelSchema = z
	.object({
		version: z.literal(WEBAUTHN_PROTOCOL_VERSION),
		type: z.literal('WEBAUTHN_CANCEL'),
		scope: hostScopeSchema,
		requestId: z.string().uuid()
	})
	.strict()
export const webAuthnReplySchema = z.discriminatedUnion('type', [
	base
		.extend({
			type: z.literal('WEBAUTHN_CREATED'),
			credentialId: encoded,
			prfEnabled: z.boolean()
		})
		.strict(),
	base
		.extend({
			type: z.literal('WEBAUTHN_ASSERTED'),
			bytes: z.custom<Uint8Array<ArrayBuffer>>(
				(value) =>
					value instanceof Uint8Array &&
					value.buffer instanceof ArrayBuffer &&
					value.byteLength === 32 &&
					value.byteOffset === 0 &&
					value.buffer.byteLength === 32
			)
		})
		.strict(),
	base.extend({ type: z.literal('WEBAUTHN_UNAVAILABLE') }).strict()
])
export type WebAuthnRequest = z.infer<typeof webAuthnRequestSchema>
export type WebAuthnReply = z.infer<typeof webAuthnReplySchema>
