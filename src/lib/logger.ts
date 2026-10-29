import { PUBLIC_DEBUG } from '$app/env/public'

export const debugEnabled = PUBLIC_DEBUG === 'true'

export type DebugValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| readonly DebugValue[]
	| { readonly [key: string]: DebugValue }

// Callers select non-sensitive diagnostics. Never pass records, tokens,
// credentials, provider payloads, unfiltered URLs, or raw errors/messages/stacks.
type LogDetails = Readonly<Record<string, DebugValue>>

export function createLogger(scope: string) {
	return {
		info(message: string, details: LogDetails = {}) {
			if (debugEnabled) console.info(`[${scope}] ${message}`, details)
		},
		warn(message: string, details: LogDetails = {}) {
			if (debugEnabled) console.warn(`[${scope}] ${message}`, details)
		},
		error(message: string, details: LogDetails = {}) {
			if (debugEnabled) console.error(`[${scope}] ${message}`, details)
		}
	}
}
