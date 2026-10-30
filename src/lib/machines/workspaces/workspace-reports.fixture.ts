import { createActor, fromTransition, type EventObject } from 'xstate'

/** Real actor recipient: capture the public protocol without inspecting sender context. */
export function workspaceReports<Event extends EventObject>() {
	return createActor(
		fromTransition((events: Event[], event: Event) => [...events, event], [])
	).start()
}
