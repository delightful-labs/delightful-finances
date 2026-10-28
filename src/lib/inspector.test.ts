import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createActor, createMachine, fromPromise, spawnChild } from 'xstate'
import type { StatelyInspectionEvent } from '@statelyai/inspect'

const fixture = vi.hoisted(() => ({
	browser: true,
	PUBLIC_DEBUG: 'true',
	events: new Array<StatelyInspectionEvent>(),
	open: vi.fn(),
	fail: false
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
	vi.stubGlobal('window', {
		open: fixture.open,
		addEventListener: vi.fn(),
		requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0)
	})
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
	expect(fixture.open).toHaveBeenCalledTimes(1)
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
