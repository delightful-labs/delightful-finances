import { browser } from '$app/env'
import { createJazzSessionAcquisition } from 'delightful-local-first/backend/jazz/session'
import { createJazzStartupRegistry } from 'delightful-local-first/backend/jazz/startup'
import type { JazzClientConfig, JazzSession, JazzClient } from 'jazz-tools/client'
export type { JazzStartupBinding } from 'delightful-local-first/backend/jazz/startup'
// Stable loader identity lets layout reattachment reuse the retained owner.
export const loadLocalFirstClient = () => import('jazz-tools/local-first')
const registry = createJazzStartupRegistry(createJazzSessionAcquisition)
export const getCurrentJazzSession = registry.getCurrentJazzSession
export function getJazzStartupBinding(config: JazzClientConfig) {
	if (!browser) throw new Error('Jazz startup binding requires the browser')
	return registry.getJazzStartupBinding(config)
}

/** SDK preparation only; the application chart owns waiting and shutdown. */
export async function prepareLocalFirstSession(session: JazzSession<JazzClient>) {
	const db = session.getSnapshot().client?.db
	if (!db) throw new Error('Finance session unavailable')
	await db.upgradeToLocalFirst(loadLocalFirstClient)
}
