import { z } from 'zod'
import { hostScopeSchema } from './host-protocol.js'

export const ACCOUNT_LOCK_PROTOCOL_VERSION = 1
export const MAX_ACCOUNT_LOCKS = 2
const correlation = z.object({
	version: z.literal(ACCOUNT_LOCK_PROTOCOL_VERSION),
	scope: hostScopeSchema,
	requestId: z.string().uuid(),
	leaseId: z.string().uuid(),
	sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
})
export const accountLockRequestSchema = z.discriminatedUnion('type', [
	correlation.extend({ type: z.literal('ACQUIRE'), key: z.string().min(1).max(65_536) }).strict(),
	correlation.extend({ type: z.literal('RELEASE') }).strict()
])
export const accountLockReplySchema = z.discriminatedUnion('type', [
	correlation.extend({ type: z.literal('ACQUIRED') }).strict(),
	correlation.extend({ type: z.literal('RELEASED') }).strict(),
	correlation.extend({ type: z.literal('FAILED') }).strict()
])
export type AccountLockRequest = z.infer<typeof accountLockRequestSchema>
export type AccountLockReply = z.infer<typeof accountLockReplySchema>
export type AccountLockCommand = {
	[Kind in AccountLockRequest['type']]: Omit<
		Extract<AccountLockRequest, { type: Kind }>,
		'sequence'
	>
}[AccountLockRequest['type']]

/** The account-store chart requires only an exclusive, abortable native lease.
 * Both native LockManager and the private worker adapter satisfy this contract. */
export type AccountLocks = {
	request: (
		key: string,
		options: { signal: AbortSignal },
		callback: () => Promise<void>
	) => Promise<void>
}
export type AccountStorageLeases = {
	primary: () => string | undefined
	earlier: (key: string) => string | undefined
}
