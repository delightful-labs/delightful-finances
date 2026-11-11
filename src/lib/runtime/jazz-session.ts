import { browser } from '$app/env'
import { createJazzStartupRegistry } from 'delightful-local-first/backend/jazz/startup'
import type { JazzClientConfig } from 'jazz-tools/client'
import { createFinanceSessionAcquisition } from './jazz-session-capabilities.js'
export { loadLocalFirstClient, prepareLocalFirstSession } from './jazz-session-capabilities.js'
export type { JazzStartupBinding } from 'delightful-local-first/backend/jazz/startup'
const registry = createJazzStartupRegistry(createFinanceSessionAcquisition)
export const getCurrentJazzSession = registry.getCurrentJazzSession
export const getCurrentSessionAvailability = registry.getCurrentSessionAvailability
export function getJazzStartupBinding(config: JazzClientConfig) {
	if (!browser) throw new Error('Jazz startup binding requires the browser')
	return registry.getJazzStartupBinding(config)
}
