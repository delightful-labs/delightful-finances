import {
	createJazzSession,
	type JazzClient,
	type JazzSession,
	type JazzSessionConfig
} from 'jazz-tools/svelte'

let sharedSession: JazzSession<JazzClient> | undefined
let sessionPromise: Promise<JazzSession<JazzClient>> | undefined

export function getCurrentJazzSession() {
	return sharedSession
}

export function getOrCreateJazzSession(config: JazzSessionConfig) {
	if (sharedSession) return Promise.resolve(sharedSession)
	if (!sessionPromise) {
		sessionPromise = createJazzSession(config)
			.then((session) => {
				sharedSession = session
				return session
			})
			.catch((error: unknown) => {
				sessionPromise = undefined
				throw error
			})
	}
	return sessionPromise
}
