import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createActor, createMachine, fromPromise, spawnChild } from 'xstate'
import type { StatelyInspectionEvent } from '@statelyai/inspect'

const fixture = vi.hoisted(() => ({
	browser: true,
	PUBLIC_DEBUG: 'true',
	events: new Array<StatelyInspectionEvent>(),
	open: vi.fn(),
	fail: false,
	postMessage: vi.fn(),
	focus: vi.fn(),
	listeners: new Array<{
		listener: EventListenerOrEventListenerObject
		signal: AbortSignal | undefined
	}>()
}))
vi.mock('$app/env', () => fixture)
vi.mock('$app/env/public', () => fixture)
vi.mock('@statelyai/inspect', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@statelyai/inspect')>()
	return {
		...actual,
		createBrowserInspector: vi.fn(
			(options: Parameters<typeof actual.createBrowserInspector>[0]) => {
				if (fixture.fail) throw new Error('PRIVATE_ATTACH_ERROR')
				return actual.createBrowserInspector({
					...options,
					send: (event) => fixture.events.push(event)
				})
			}
		)
	}
})

beforeEach(() => {
	vi.resetModules()
	fixture.events.length = 0
	fixture.browser = true
	fixture.PUBLIC_DEBUG = 'true'
	fixture.fail = false
	fixture.open.mockReset()
	fixture.postMessage.mockReset()
	fixture.focus.mockReset()
	fixture.listeners.length = 0
	vi.stubGlobal('window', {
		open: fixture.open,
		addEventListener: (
			_type: string,
			listener: EventListenerOrEventListenerObject,
			options?: AddEventListenerOptions
		) => {
			fixture.listeners.push({ listener, signal: options?.signal })
		},
		postMessage: fixture.postMessage,
		focus: fixture.focus,
		closed: false,
		requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0)
	})
	fixture.open.mockImplementation(() => window)
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

it.each([
	{ browser: false, flag: 'true' },
	{ browser: true, flag: 'false' }
])('does not initialize on SSR or when disabled: $browser/$flag', async ({ browser, flag }) => {
	fixture.browser = browser
	fixture.PUBLIC_DEBUG = flag
	const { inspectActor } = await import('./inspector.js')
	const actor = createActor(createMachine({}), { inspect: inspectActor }).start()
	actor.stop()
	expect(fixture.open).not.toHaveBeenCalled()
	expect(fixture.events).toEqual([])
})

it('uses the real SDK to inspect descendants while removing data before buffering', async () => {
	const { inspectActor } = await import('./inspector.js')
	const child = createMachine({
		id: 'fixture-child',
		context: { secret: 'PRIVATE_CHILD_CONTEXT' },
		initial: 'working',
		output: { secret: 'PRIVATE_CHILD_OUTPUT' },
		states: { working: { after: { 0: 'finished' } }, finished: { type: 'final' } }
	})
	const machine = createMachine({
		id: 'fixture-root',
		context: { secret: 'PRIVATE_ROOT_CONTEXT' },
		initial: 'running',
		entry: spawnChild(child, { id: 'PRIVATE_PROVIDER_ACTOR_ID' }),
		states: {
			running: {
				on: { FINISH: 'done' }
			},
			done: { type: 'final' }
		},
		output: { secret: 'PRIVATE_ROOT_OUTPUT' }
	})
	const actor = createActor(machine, { inspect: inspectActor }).start()
	await new Promise((resolve) => setTimeout(resolve, 10))
	actor.send({ type: 'FINISH', token: 'PRIVATE_EVENT_PAYLOAD' })
	await vi.waitFor(() =>
		expect(fixture.events).toContainEqual(
			expect.objectContaining({ type: '@xstate.event', event: { type: 'FINISH' } })
		)
	)
	const registrations = fixture.events.filter((event) => event.type === '@xstate.actor')
	expect(registrations).toHaveLength(2)
	expect(registrations[1]?.parentId).toBe(actor.sessionId)
	expect(fixture.events).toContainEqual(
		expect.objectContaining({
			type: '@xstate.snapshot',
			snapshot: { status: 'done', value: 'done', output: undefined, error: undefined },
			event: { type: 'FINISH' }
		})
	)
	expect(fixture.events).toContainEqual(
		expect.objectContaining({
			type: '@xstate.event',
			event: { type: 'FINISH' }
		})
	)
	expect(JSON.stringify(fixture.events)).not.toContain('PRIVATE_')
	expect(registrations[0]?.definition).toContain('running')
	expect(fixture.events).toContainEqual(
		expect.objectContaining({ type: '@xstate.event', event: { type: 'xstate.done.actor.[actor]' } })
	)
	expect(fixture.open).not.toHaveBeenCalled()
	actor.stop()
})

it('cannot fail application startup when inspector construction throws', async () => {
	fixture.fail = true
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	const { inspectActor } = await import('./inspector.js')
	const actor = createActor(createMachine({ initial: 'ready', states: { ready: {} } }), {
		inspect: inspectActor
	})
	expect(() => actor.start()).not.toThrow()
	expect(actor.getSnapshot().value).toBe('ready')
	expect(warn).toHaveBeenCalledWith('[inspector] Inspector could not attach', {})
	expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_')
	actor.stop()
})

it('removes rejected actor errors from the real SDK output', async () => {
	const { inspectActor } = await import('./inspector.js')
	const actor = createActor(
		fromPromise(async () => {
			throw new Error('PRIVATE_RUNTIME_ERROR')
		}),
		{
			id: 'PRIVATE_PROVIDER_PROMISE_ID',
			inspect: inspectActor
		}
	)
	actor.subscribe({ error: () => {} })
	actor.start()
	await vi.waitFor(() =>
		expect(fixture.events).toContainEqual(
			expect.objectContaining({
				type: '@xstate.snapshot',
				snapshot: { status: 'error', output: undefined, error: undefined }
			})
		)
	)
	expect(JSON.stringify(fixture.events)).not.toContain('PRIVATE_')
	actor.stop()
})

it('never traverses live context before the SDK sanitizers run', async () => {
	const { inspectActor } = await import('./inspector.js')
	const readPrivateValue = vi.fn(() => 'PRIVATE_CONTEXT_VALUE')
	const privatePayload = Object.defineProperty({}, 'token', {
		enumerable: true,
		get: readPrivateValue
	})
	const actor = createActor(
		createMachine({
			id: 'private-context-fixture',
			context: () => ({ privatePayload }),
			initial: 'waiting',
			states: { waiting: { on: { ADVANCE: 'finished' } }, finished: { type: 'final' } }
		}),
		{ inspect: inspectActor }
	).start()
	actor.send({ type: 'ADVANCE', privatePayload })
	await vi.waitFor(() =>
		expect(fixture.events).toContainEqual(
			expect.objectContaining({
				type: '@xstate.snapshot',
				snapshot: expect.objectContaining({ status: 'done' })
			})
		)
	)
	expect(readPrivateValue).not.toHaveBeenCalled()
	expect(JSON.stringify(fixture.events)).not.toContain('PRIVATE_CONTEXT_VALUE')
	actor.stop()
})

it('opens only on request and replays current topology after event history rolls over', async () => {
	const { inspectActor, openStateInspector } = await import('./inspector.js')
	const actor = createActor(
		createMachine({
			id: 'retained-machine',
			initial: 'waiting',
			states: {
				waiting: { on: { PING: {}, FINISH: 'finished' } },
				finished: { type: 'final' }
			}
		}),
		{ inspect: inspectActor }
	).start()
	for (let i = 0; i < 300; i += 1) actor.send({ type: 'PING' })
	actor.send({ type: 'FINISH' })
	await vi.waitFor(() =>
		expect(fixture.events).toContainEqual(
			expect.objectContaining({
				type: '@xstate.snapshot',
				snapshot: expect.objectContaining({ status: 'done' })
			})
		)
	)
	expect(fixture.open).not.toHaveBeenCalled()
	openStateInspector()
	expect(fixture.open).toHaveBeenCalledTimes(1)
	const connected = Object.assign(new Event('message'), {
		data: { type: '@statelyai.connected' },
		origin: 'https://stately.ai',
		source: window
	})
	for (const { listener, signal } of fixture.listeners) {
		if (signal?.aborted) continue
		if (typeof listener === 'function') listener(connected)
		else listener.handleEvent(connected)
	}
	expect(fixture.postMessage).toHaveBeenCalledWith(
		expect.objectContaining({
			type: '@xstate.actor',
			name: 'retained-machine',
			snapshot: expect.objectContaining({ status: 'done', value: 'finished' })
		}),
		'https://stately.ai'
	)
	openStateInspector()
	expect(fixture.open).toHaveBeenCalledTimes(1)
	expect(fixture.focus).toHaveBeenCalledOnce()
	actor.stop()
})

it('preserves deeply nested chart definitions for the hosted renderer', async () => {
	const { inspectActor } = await import('./inspector.js')
	type Node = { initial?: string; states?: Record<string, Node>; type?: 'final' }
	let nested: Node = { type: 'final' }
	for (let i = 0; i < 16; i += 1) nested = { initial: 'child', states: { child: nested } }
	const actor = createActor(
		createMachine({ id: 'deep-machine', initial: 'nested', states: { nested } }),
		{ inspect: inspectActor }
	).start()
	await vi.waitFor(() =>
		expect(fixture.events.some((event) => event.type === '@xstate.actor')).toBe(true)
	)
	const registration = fixture.events.find((event) => event.type === '@xstate.actor')
	if (registration?.type !== '@xstate.actor') throw new Error('Missing registration')
	expect(registration.definition).not.toContain('[Object]')
	expect(registration.definition).not.toContain('[Array]')
	expect(registration.definition).toContain('"type":"final"')
	actor.stop()
})
