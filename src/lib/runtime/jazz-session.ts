import { browser } from '$app/env'
import { createJazzSessionAcquisition } from 'delightful-local-first/backend/jazz/session'
import { createJazzStartupRegistry } from 'delightful-local-first/backend/jazz/startup'
import type { JazzSessionConfig } from 'jazz-tools/svelte'
export type { JazzStartupBinding } from 'delightful-local-first/backend/jazz/startup'
const registry = createJazzStartupRegistry(createJazzSessionAcquisition)
export const getCurrentJazzSession = registry.getCurrentJazzSession
export function getJazzStartupBinding(config: JazzSessionConfig) {
	if (!browser) throw new Error('Jazz startup binding requires the browser')
	return registry.getJazzStartupBinding(config)
}
