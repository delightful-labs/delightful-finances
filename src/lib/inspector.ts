import { browser } from '$app/env'
import { createBrowserInspector, type StatelyInspectionEvent } from '@statelyai/inspect'
import type { InspectionEvent, Snapshot } from 'xstate'
import { createLogger, debugEnabled } from './logger.js'

const logger = createLogger('inspector')
let inspector: ReturnType<typeof createBrowserInspector> | undefined
const lifetime = new AbortController()

// The SDK's stop() does not remove its browser message listener. Scope that
// listener to this module so a later inspector cannot reconnect the old adapter.
function inspectorWindow() {
	return new Proxy(window, {
		get(target, key) {
			if (key === 'addEventListener')
				return (
					type: string,
					listener: EventListenerOrEventListenerObject,
					options?: boolean | AddEventListenerOptions
				) =>
					target.addEventListener(type, listener, {
						...(typeof options === 'boolean' ? { capture: options } : options),
						signal: lifetime.signal
					})
			const value: unknown = Reflect.get(target, key, target)
			return typeof value === 'function' ? value.bind(target) : value
		}
	})
}

// Machine definitions describe static topology, not live inputs/context. Exclude
// data-bearing configuration fields even if a machine embeds literal defaults.
const privateDefinitionFields = new Set(['context', 'input', 'output', 'params', 'meta', 'data'])
function safeDefinition(definition: string | undefined, sessionId: string) {
	if (!definition) return { definition: undefined, name: sessionId }
	const parsed: unknown = JSON.parse(definition)
	// The SDK uses actor.id as a fallback definition for non-machine actors.
	// Dynamic actor IDs can contain provider identifiers; retain only machine IDs.
	const machine = parsed && typeof parsed === 'object' && 'states' in parsed ? parsed : undefined
	const name = machine && 'id' in machine && typeof machine.id === 'string' ? machine.id : sessionId
	return {
		name,
		definition: JSON.stringify(machine ?? { id: sessionId }, (key, value: unknown) =>
			privateDefinitionFields.has(key) ? undefined : value
		)
	}
}

function safeEventType(type: string) {
	// XState appends the invocation's actor ID to these internal event names.
	return type.replace(/^(xstate\.(?:done\.actor|error\.actor|snapshot))\..+$/, '$1.[actor]')
}

// Rebuild snapshots rather than spreading them: output, errors, child references,
// persisted inputs and future SDK fields must never reach the inspector buffer.
function safeSnapshot(snapshot: unknown): Snapshot<undefined> & { value?: unknown } {
	const status =
		snapshot && typeof snapshot === 'object' && 'status' in snapshot ? snapshot.status : undefined
	return {
		status: status === 'done' || status === 'error' || status === 'stopped' ? status : 'active',
		output: undefined,
		error: undefined,
		...(snapshot && typeof snapshot === 'object' && 'value' in snapshot
			? { value: snapshot.value }
			: {})
	}
}

function serialize(event: StatelyInspectionEvent): StatelyInspectionEvent {
	if (event.type === '@xstate.event')
		return { ...event, event: { type: safeEventType(event.event.type) } }
	if (event.type === '@xstate.snapshot')
		return {
			...event,
			event: { type: safeEventType(event.event.type) },
			snapshot: safeSnapshot(event.snapshot)
		}
	return {
		...event,
		...safeDefinition(event.definition, event.sessionId),
		snapshot: safeSnapshot(event.snapshot)
	}
}

/** Attach at existing roots; XState automatically includes their descendants. */
export function inspectActor(event: InspectionEvent) {
	if (!browser || !debugEnabled || lifetime.signal.aborted) return
	try {
		inspector ??= createBrowserInspector({
			window: inspectorWindow(),
			sanitizeContext: () => ({}),
			sanitizeEvent: (event) => ({ type: safeEventType(event.type) }),
			serialize,
			maxDeferredEvents: 200
		})
		// The SDK serializes snapshot events before its sanitizeContext hook runs.
		// Project first so it never traverses Jazz clients or private live context.
		inspector.inspect.next?.(
			event.type === '@xstate.snapshot'
				? {
						...event,
						event: { type: safeEventType(event.event.type) },
						snapshot: safeSnapshot(event.snapshot)
					}
				: event
		)
	} catch {
		// Optional tooling must not fail the application or expose raw errors.
		logger.warn('Inspector could not attach')
	}
}

if (import.meta.hot)
	import.meta.hot.dispose(() => {
		inspector?.stop()
		lifetime.abort()
		inspector = undefined
	})
