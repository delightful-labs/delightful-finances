import { PUBLIC_DEBUG } from '$app/env/public'

export const debugEnabled = PUBLIC_DEBUG === 'true'

// Callers select non-sensitive scalar diagnostics. Never pass records, tokens,
// credentials, provider payloads, URLs, or raw errors (including messages/stacks).
type LogDetails = Readonly<Record<string, string | number | boolean | null | undefined>>

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
