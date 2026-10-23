import type { InspectionEvent } from 'xstate'

type Actor = InspectionEvent['actorRef']
type Lifecycle = 'active' | 'done' | 'error' | 'stopped'
export type ActorTraceEntry = Readonly<{
	sequence: number
	system: number
	actor: number
	kind: 'actor' | 'event' | 'snapshot' | 'ownership'
	label: string
	source?: number | undefined
	parent?: number | undefined
	cause?: number | undefined
	event?: string | undefined
	status?: Lifecycle | undefined
}>
export type ActorTraceView = {
	read: () => readonly ActorTraceEntry[]
	clear: () => void
	disable: () => void
}
const events = new Set([
	'START',
	'RETRY',
	'SHUTDOWN',
	'CANCEL',
	'INVALIDATE',
	'RESET',
	'OBSERVE',
	'OBSERVED',
	'OPEN',
	'CLOSE',
	'CHANGE',
	'SUBMIT',
	'RECOVER',
	'RETRY_NAVIGATION',
	'WORKSPACE_CLOSED',
	'ATTACH_WORKSPACE',
	'DETACH_WORKSPACE',
	'SELECT_WORKSPACE',
	'CREATION',
	'BANK',
	'SESSION_OBSERVED',
	'SESSION_OBSERVER_FAILED',
	'RECOVERY_VALIDATED',
	'RECOVERY_DRAIN_REQUESTED',
	'WORKSPACE_DRAINED',
	'RETRY_READINESS',
	'RETRY_COMPLETION'
])
const labels = new Set([
	'application-readiness',
	'session-startup',
	'session-recovery',
	'workspace-readiness',
	'workspace-startup',
	'workspace-creation',
	'workspace-navigation',
	'workspace-integrity-owner',
	'bank',
	'scoped-form',
	'profile-avatar',
	'account-archive',
	'account-order',
	'recovery-phrase',
	'sample-transactions'
])
function eventName(name: string) {
	if (events.has(name)) return name
	if (name === 'xstate.init') return name
	if (name.startsWith('xstate.done.actor.')) return 'xstate.done.actor'
	if (name.startsWith('xstate.error.actor.')) return 'xstate.error.actor'
	if (name.startsWith('xstate.snapshot.')) return 'xstate.snapshot'
	if (name.startsWith('xstate.done.state.')) return 'xstate.done.state'
	return 'other'
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}
function label(snapshot: unknown) {
	if (!record(snapshot) || !record(snapshot.machine)) return 'actor'
	const id = snapshot.machine.id
	return typeof id === 'string' && labels.has(id) ? id : 'actor'
}
function isActor(value: unknown): value is Actor {
	return (
		record(value) &&
		typeof value.sessionId === 'string' &&
		typeof value.send === 'function' &&
		typeof value.getSnapshot === 'function'
	)
}

/** Project synchronously; never buffer raw inspection events or actor snapshots. */
export function createActorTrace(capacity = 500) {
	const limit = Number.isFinite(capacity) ? Math.max(1, Math.min(1000, Math.floor(capacity))) : 500
	let enabled = true
	let sequence = 0
	let nextActor = 0
	const actors = new WeakMap<Actor, number>()
	const parents = new WeakMap<Actor, number>()
	const deliveries = new WeakMap<object, WeakMap<Actor, { queue: number[]; overflow: boolean }>>()
	const systems = new Map<string, number>()
	let entries: ActorTraceEntry[] = []
	function id(actor: Actor) {
		const previous = actors.get(actor)
		if (previous !== undefined) return previous
		const value = ++nextActor
		actors.set(actor, value)
		return value
	}
	function append(entry: Omit<ActorTraceEntry, 'sequence'>) {
		const value = Object.freeze({ ...entry, sequence: ++sequence })
		entries.push(value)
		if (entries.length > limit) entries.shift()
		return value.sequence
	}
	function inspect(event: InspectionEvent) {
		if (!enabled) return
		try {
			let system = systems.get(event.rootId)
			if (system === undefined) {
				if (systems.size >= 128) return
				system = systems.size + 1
				systems.set(event.rootId, system)
			}
			const actor = id(event.actorRef)
			if (event.type === '@xstate.actor') {
				append({ kind: 'actor', system, actor, label: 'actor' })
			}
			if (event.type === '@xstate.event') {
				const delivered = append({
					kind: 'event',
					system,
					actor,
					label: 'actor',
					source: event.sourceRef ? id(event.sourceRef) : undefined,
					event: eventName(event.event.type)
				})
				let recipients = deliveries.get(event.event)
				if (!recipients) {
					recipients = new WeakMap()
					deliveries.set(event.event, recipients)
				}

				const delivery = recipients.get(event.actorRef) ?? { queue: [], overflow: false }
				if (!delivery.overflow) {
					if (delivery.queue.length >= limit) {
						delivery.queue = []
						delivery.overflow = true
					} else delivery.queue.push(delivered)
				}
				recipients.set(event.actorRef, delivery)
			}
			if (event.type === '@xstate.snapshot' || event.type === '@xstate.microstep') {
				const snapshot = event.snapshot
				if (event.type === '@xstate.snapshot') {
					const delivery = deliveries.get(event.event)?.get(event.actorRef)
					const cause = delivery?.overflow ? undefined : delivery?.queue.shift()
					const status = snapshot.status
					append({
						kind: 'snapshot',
						system,
						actor,
						label: label(snapshot),
						status:
							status === 'active' || status === 'done' || status === 'error' || status === 'stopped'
								? status
								: undefined,
						cause,
						event: eventName(event.event.type)
					})
				}
				if ('children' in snapshot && record(snapshot.children)) {
					for (const child of Object.values(snapshot.children)) {
						if (!isActor(child) || parents.get(child) === actor) continue
						parents.set(child, actor)
						append({ kind: 'ownership', system, actor: id(child), parent: actor, label: 'actor' })
					}
				}
			}
		} catch {
			// An optional diagnostic must never fail the actor being observed.
		}
	}
	const view: ActorTraceView = Object.freeze({
		read: () => entries.slice(),
		clear: () => {
			entries = []
		},
		disable: () => {
			enabled = false
			entries = []
			systems.clear()
		}
	})
	return { inspect, view }
}

declare global {
	interface Window {
		__delightfulActorTrace?: ActorTraceView
	}
}
let initialized = false
let inspector: ((event: InspectionEvent) => void) | undefined

/** Browser-local opt-in only. No actor references are published through the console API. */
export function initializeActorInspection(developmentBrowser: boolean) {
	if (!developmentBrowser || initialized) return
	initialized = true
	try {
		if (window.sessionStorage.getItem('delightful:actor-inspection') !== '1') return
		const trace = createActorTrace()
		Object.defineProperty(window, '__delightfulActorTrace', {
			value: trace.view,
			configurable: true
		})
		inspector = trace.inspect
	} catch {
		inspector = undefined
	}
}
export function actorInspection(): { inspect?: (event: InspectionEvent) => void } {
	return inspector ? { inspect: inspector } : {}
}
