import { createJazzSessionAcquisition } from 'delightful-local-first/backend/jazz/session'
import type { JazzClientConfig, JazzClient, JazzSession } from 'jazz-tools/client'

export const loadLocalFirstClient = () => import('jazz-tools/local-first')

/** The pinned SDK transports this native contention as an Error message. */
function classifyStorageAvailability(error: unknown) {
	if (!(error instanceof Error)) return undefined
	const match =
		/^IndexedDB database (.+) is active in another Jazz SharedWorker realm; wait for that worker to close before retrying$/.exec(
			error.message
		)
	return match?.[1] ? { resourceKey: `jazz:browser-physical-database:${match[1]}` } : undefined
}
function waitForStorageAvailability(resourceKey: string, signal: AbortSignal) {
	return navigator.locks.request(resourceKey, { mode: 'shared', signal }, () => {})
}
export function createFinanceSessionAcquisition(config: JazzClientConfig) {
	const acquisition = createJazzSessionAcquisition(config)
	return {
		...acquisition,
		capability: {
			...acquisition.capability,
			availability: { classify: classifyStorageAvailability, wait: waitForStorageAvailability }
		}
	}
}
export async function prepareLocalFirstSession(session: JazzSession<JazzClient>) {
	const db = session.getSnapshot().client?.db
	if (!db) throw new Error('Finance session unavailable')
	await db.upgradeToLocalFirst(loadLocalFirstClient)
}
