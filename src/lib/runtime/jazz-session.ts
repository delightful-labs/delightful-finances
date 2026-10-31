import { browser } from '$app/env'
import { createActor } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import type { JazzClient, JazzSession, JazzSessionConfig } from 'jazz-tools/svelte'
import { createJazzSessionAcquisition } from 'delightful-local-first/backend/jazz/session'
import {
	createSessionAcquisitionMachine,
	selectAcquiredSession
} from 'delightful-local-first/session/workflow'
import type { SessionOwnerRef } from 'delightful-local-first/session/workflow'
import type { SessionScope } from 'delightful-local-first/session/contracts'

type Session = JazzSession<JazzClient>
type Owner = ActorRefFrom<ReturnType<typeof createSessionAcquisitionMachine<Session>>>
export type JazzStartupBinding = Readonly<{ owner: SessionOwnerRef<Session>; scope: SessionScope }>

// One browser-scoped actor reference, not a second session/promise cache. The actor owns acquisition.
let shared: { owner: Owner; binding: object; config: JazzSessionConfig } | undefined

function sameConfiguration(left: JazzSessionConfig, right: JazzSessionConfig): boolean {
	const expected: Record<string, unknown> = { ...left }
	const actual: Record<string, unknown> = { ...right }
	return (
		Object.keys(expected).length === Object.keys(actual).length &&
		Object.keys(expected).every((key) => expected[key] === actual[key])
	)
}

export function getCurrentJazzSession(): Session | undefined {
	return shared ? selectAcquiredSession(shared.owner.getSnapshot()) : undefined
}

/** Browser mount binding only. The retained owner survives layout detach and pending SDK creation. */
export function getJazzStartupBinding(config: JazzSessionConfig): JazzStartupBinding {
	if (!browser) throw new Error('Jazz startup binding requires the browser')
	if (shared && !sameConfiguration(shared.config, config)) {
		throw new Error('Jazz environment replacement requires coordinated cleanup')
	}
	if (!shared) {
		const adapter = createJazzSessionAcquisition(config)
		const owner = createActor(createSessionAcquisitionMachine<Session>(), {
			input: adapter
		}).start()
		shared = { owner, binding: adapter.binding, config: { ...config } }
	}
	return {
		owner: shared.owner,
		scope: { binding: shared.binding, attachment: {}, generation: 0 }
	}
}
