import { browser } from '$app/env'
import {
	createBrowserInspector,
	type StatelyActorEvent,
	type StatelyInspectionEvent
} from '@statelyai/inspect'
import type { InspectionEvent, Snapshot } from 'xstate'
import { createLogger, debugEnabled } from './logger.js'

const logger = createLogger('inspector')
let inspector: ReturnType<typeof createBrowserInspector> | undefined
const lifetime = new AbortController()
let listeners = new AbortController()
// Sanitized diagnostic data only: no actor references or application context.
// Keep registrations/current states separate from the SDK's rolling event history.
const topology = new Map<string, StatelyActorEvent>()

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
						signal: listeners.signal
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

function sanitize(event: StatelyInspectionEvent): StatelyInspectionEvent {
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

function serialize(event: StatelyInspectionEvent): StatelyInspectionEvent {
	const safe = sanitize(event)
	if (safe.type === '@xstate.actor') topology.set(safe.sessionId, safe)
	if (safe.type === '@xstate.snapshot') {
		const registration = topology.get(safe.sessionId)
		if (registration) {
			topology.delete(safe.sessionId)
			topology.set(safe.sessionId, { ...registration, snapshot: safe.snapshot })
		}
	}
	// Bound historical descriptors across route changes and completed actors.
	if (topology.size > 1000) {
		const oldest = topology.keys().next().value
		if (oldest !== undefined) topology.delete(oldest)
	}
	return safe
}

function getInspector() {
	inspector ??= createBrowserInspector({
		window: inspectorWindow(),
		autoStart: false,
		// Our composed charts exceed the SDK's default depth of 10. Truncated
		// "[Object]" state nodes crash the hosted machine renderer.
		serializationDepthLimit: 100,
		sanitizeContext: () => ({}),
		sanitizeEvent: (event) => ({ type: safeEventType(event.type) }),
		serialize,
		maxDeferredEvents: 200
	})
	return inspector
}

/** Called directly from the menu click so popup permission follows user intent. */
export function openStateInspector() {
	if (!browser || !debugEnabled || lifetime.signal.aborted) return
	try {
		const current = getInspector()
		const target = current.adapter.targetWindow
		if (target && !target.closed) {
			target.focus()
			return
		}
		listeners.abort()
		listeners = new AbortController()
		window.addEventListener(
			'message',
			(event: MessageEvent<unknown>) => {
				const target = current.adapter.targetWindow
				const data = event.data
				if (
					event.source !== target ||
					event.origin !== 'https://stately.ai' ||
					!data ||
					typeof data !== 'object' ||
					!('type' in data) ||
					data.type !== '@statelyai.connected'
				)
					return
				for (const registration of topology.values())
					target?.postMessage(registration, 'https://stately.ai')
			},
			{ signal: listeners.signal }
		)
		current.start()
		if (!current.adapter.targetWindow) logger.warn('Allow popups to open Stately Inspector')
	} catch {
		logger.warn('Inspector could not open')
	}
}

/** Attach at existing roots; XState automatically includes their descendants. */
export function inspectActor(event: InspectionEvent) {
	if (!browser || !debugEnabled || lifetime.signal.aborted) return
	try {
		const current = getInspector()
		// The SDK serializes snapshot events before its sanitizeContext hook runs.
		// Project first so it never traverses Jazz clients or private live context.
		current.inspect.next?.(
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
		listeners.abort()
		lifetime.abort()
		topology.clear()
		inspector = undefined
	})
