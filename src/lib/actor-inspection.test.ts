import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise, setup, waitFor, type Snapshot } from 'xstate'
import { createActorTrace } from './actor-inspection.js'

const privateValue = 'private-finance-credential-phrase-https://provider.invalid/key'
function logic() {
	return setup<{ sensitive: string }, { type: string; payload?: unknown }>({}).createMachine({
		id: privateValue,
		context: { sensitive: privateValue },
		initial: 'idle',
		states: { idle: { on: { SUBMIT: 'working' } }, working: {} }
	})
}
afterEach(() => vi.unstubAllGlobals())

describe('redacted actor trace', () => {
	it('correlates real message delivery, snapshots, ownership and finite completion without private data', async () => {
		const trace = createActorTrace()
		const pending = Promise.withResolvers<string>()
		const child = fromPromise(() => pending.promise)
		const machine = setup<
			{ sensitive: string },
			{ type: 'SUBMIT'; payload: unknown },
			{ child: typeof child }
		>({ actors: { child } }).createMachine({
			id: 'application-readiness',
			context: { sensitive: privateValue },
			initial: 'idle',
			states: {
				idle: { on: { SUBMIT: 'working' } },
				working: { invoke: { id: privateValue, src: 'child', onDone: 'done' } },
				done: { type: 'final' }
			},
			output: () => privateValue
		})
		const actor = createActor(machine, { id: privateValue, inspect: trace.inspect }).start()
		actor.send({
			type: 'SUBMIT',
			payload: { phrase: privateValue, amountMinor: 987654321, workspaceId: privateValue }
		})
		pending.resolve(privateValue)
		await waitFor(actor, (s) => s.status === 'done')
		const entries = trace.view.read()
		const delivered = entries.find((entry) => entry.kind === 'event' && entry.event === 'SUBMIT')
		expect(delivered).toBeDefined()
		expect(
			entries.some(
				(entry) =>
					entry.kind === 'snapshot' &&
					entry.cause === delivered?.sequence &&
					entry.event === 'SUBMIT'
			)
		).toBe(true)
		expect(
			entries.some((entry) => entry.kind === 'ownership' && entry.parent === delivered?.actor)
		).toBe(true)
		expect(
			entries.some((entry) => entry.event === 'xstate.done.actor' && entry.source !== undefined)
		).toBe(true)
		expect(entries.some((entry) => entry.status === 'done')).toBe(true)
		expect(entries.some((entry) => entry.label === 'application-readiness')).toBe(true)
		const serialized = JSON.stringify(entries)
		expect(serialized).not.toContain(privateValue)
		expect(serialized).not.toContain('987654321')
		expect(serialized).not.toMatch(/payload|context|output|errorMessage|actorRef|sessionId/)
	})
	it('normalizes arbitrary event and machine names and exposes immutable detached records', () => {
		const trace = createActorTrace()
		const actor = createActor(logic(), { inspect: trace.inspect, id: privateValue }).start()
		actor.send({ type: privateValue, payload: privateValue })
		trace.inspect({
			type: '@xstate.event',
			rootId: actor.sessionId,
			actorRef: actor,
			sourceRef: undefined,
			event: { type: `xstate.error.actor.${privateValue}`, payload: privateValue }
		})
		const entries = trace.view.read()
		expect(entries.some((entry) => entry.event === 'other')).toBe(true)
		expect(entries.some((entry) => entry.event === 'xstate.error.actor')).toBe(true)
		expect(JSON.stringify(entries)).not.toContain(privateValue)
		expect(entries.every(Object.isFrozen)).toBe(true)
		Reflect.deleteProperty(entries, '0')
		expect(trace.view.read()[0]).toBeDefined()
		actor.stop()
	})
	it('records stopped/error lifetimes without retaining exception details', async () => {
		const trace = createActorTrace()
		const stopped = createActor(logic(), { inspect: trace.inspect }).start()
		stopped.stop()
		const failed = createActor(
			fromPromise(async () => {
				throw new Error(privateValue)
			}),
			{ inspect: trace.inspect }
		)
		failed.subscribe({ error: () => {} })
		failed.start()
		await vi.waitFor(() => expect(failed.getSnapshot().status).toBe('error'))
		expect(trace.view.read().some((entry) => entry.status === 'stopped')).toBe(true)
		expect(trace.view.read().some((entry) => entry.status === 'error')).toBe(true)
		expect(JSON.stringify(trace.view.read())).not.toContain(privateValue)
	})
	it('bounds history, retains monotonic correlation, clears and disables an existing hook', () => {
		const trace = createActorTrace(3)
		const actor = createActor(logic(), { inspect: trace.inspect }).start()
		for (let index = 0; index < 20; index++) actor.send({ type: 'OBSERVE', payload: privateValue })
		expect(trace.view.read()).toHaveLength(3)
		const last = trace.view.read().at(-1)?.sequence ?? 0
		trace.view.clear()
		expect(trace.view.read()).toEqual([])
		actor.send({ type: 'OBSERVE' })
		expect(trace.view.read()[0]?.sequence).toBeGreaterThan(last)
		trace.view.disable()
		actor.send({ type: 'SUBMIT' })
		expect(trace.view.read()).toEqual([])
		expect(actor.getSnapshot().matches('working')).toBe(true)
		actor.stop()
	})
	it('caps system metadata and distinguishes independent actor roots', () => {
		const trace = createActorTrace(1000)
		const actors = Array.from({ length: 129 }, () =>
			createActor(logic(), { inspect: trace.inspect }).start()
		)
		expect(new Set(trace.view.read().map((entry) => entry.system)).size).toBe(128)
		for (const actor of actors) actor.stop()
	})
	it('does not read context, state value, output, errors or action parameters', () => {
		const trace = createActorTrace()
		const actor = createActor(logic()).start()
		const snapshot = {
			status: 'active',
			output: undefined,
			error: undefined
		} satisfies Snapshot<undefined>
		const forbidden = vi.fn(() => {
			throw new Error(privateValue)
		})
		for (const field of ['context', 'value', 'output', 'error'])
			Object.defineProperty(snapshot, field, { get: forbidden })
		trace.inspect({
			type: '@xstate.snapshot',
			rootId: privateValue,
			actorRef: actor,
			event: { type: 'OBSERVE', privateValue },
			snapshot
		})
		trace.inspect({
			type: '@xstate.action',
			rootId: privateValue,
			actorRef: actor,
			action: {
				type: privateValue,
				get params() {
					return forbidden()
				}
			}
		})
		expect(forbidden).not.toHaveBeenCalled()
		expect(JSON.stringify(trace.view.read())).not.toContain(privateValue)
		actor.stop()
	})
	it('contains projection failures without interrupting a running actor', () => {
		const trace = createActorTrace()
		const actor = createActor(logic(), { inspect: trace.inspect }).start()
		expect(() =>
			trace.inspect({
				type: '@xstate.event',
				rootId: 'root',
				actorRef: actor,
				sourceRef: undefined,
				get event(): never {
					throw new Error(privateValue)
				}
			})
		).not.toThrow()
		actor.send({ type: 'SUBMIT' })
		expect(actor.getSnapshot().matches('working')).toBe(true)
		actor.stop()
	})
	it('omits correlation after a reused-message queue overflows instead of assigning false causes', () => {
		const trace = createActorTrace(2)
		const actor = createActor(logic()).start()
		const event = { type: 'OBSERVE' }
		for (let index = 0; index < 4; index++)
			trace.inspect({
				type: '@xstate.event',
				rootId: 'root',
				actorRef: actor,
				sourceRef: undefined,
				event
			})
		trace.inspect({
			type: '@xstate.snapshot',
			rootId: 'root',
			actorRef: actor,
			event,
			snapshot: actor.getSnapshot()
		})
		expect(trace.view.read().at(-1)?.cause).toBeUndefined()
		actor.stop()
	})
})

describe('development browser opt-in', () => {
	async function environment(flag: string | null) {
		vi.resetModules()
		const getItem = vi.fn(() => flag)
		vi.stubGlobal('window', { sessionStorage: { getItem } })
		const module = await import('./actor-inspection.js')
		return { ...module, getItem }
	}
	it('does nothing by default and in production/SSR', async () => {
		const disabled = await environment(null)
		disabled.initializeActorInspection(true)
		expect(disabled.actorInspection()).toEqual({})
		expect(window.__delightfulActorTrace).toBeUndefined()
		const production = await environment('1')
		production.initializeActorInspection(false)
		expect(production.getItem).not.toHaveBeenCalled()
		expect(production.actorInspection()).toEqual({})
		vi.stubGlobal('window', undefined)
		expect(() => production.initializeActorInspection(false)).not.toThrow()
	})
	it('fails closed when browser storage is unavailable', async () => {
		const module = await environment(null)
		module.getItem.mockImplementation(() => {
			throw new Error('Storage unavailable')
		})
		module.initializeActorInspection(true)
		expect(module.actorInspection()).toEqual({})
		expect(window.__delightfulActorTrace).toBeUndefined()
	})
	it('exposes only the sanitized view, initializes once and stays disabled after disabling', async () => {
		const module = await environment('1')
		module.initializeActorInspection(true)
		const view = window.__delightfulActorTrace
		expect(Object.keys(view ?? {}).sort()).toEqual(['clear', 'disable', 'read'])
		const actor = createActor(logic(), module.actorInspection()).start()
		expect(view?.read().length).toBeGreaterThan(0)
		module.initializeActorInspection(true)
		expect(module.getItem).toHaveBeenCalledOnce()
		view?.disable()
		module.initializeActorInspection(true)
		actor.send({ type: 'SUBMIT', payload: privateValue })
		expect(view?.read()).toEqual([])
		actor.stop()
	})
})
