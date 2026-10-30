import { afterEach, expect, it, vi } from 'vitest'
import {
	createActor,
	fromCallback,
	fromPromise,
	toPromise,
	waitFor,
	type AnyActorRef
} from 'xstate'
import { createSyncLogMachine } from './sync-log.js'
import type { Dependencies } from './types.js'
import type {
	SyncLogCompletion,
	SyncLogParentEvent,
	SyncLogStart
} from '#lib/contracts/bank-sync-log.js'
const actors: AnyActorRef[] = []
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
})
const input: SyncLogStart = {
	id: crypto.randomUUID(),
	organizationId: crypto.randomUUID(),
	connectionId: crypto.randomUUID(),
	initiatedBy: crypto.randomUUID(),
	startedAt: new Date('2026-10-30T12:00:00Z')
}
const result: SyncLogCompletion = {
	outcome: 'partial',
	finishedAt: new Date('2026-10-30T12:01:00Z'),
	importSettlement: 'locallyPersisted',
	failureCode: null,
	importedCount: 1,
	existingCount: 2,
	omittedCount: 3
}
function start(
	options: {
		begin?: () => Promise<void>
		finish?: (value: SyncLogCompletion) => Promise<void>
		input?: SyncLogStart
	} = {}
) {
	const events: SyncLogParentEvent[] = []
	const parent = createActor(
		fromCallback<SyncLogParentEvent>(({ receive }) => {
			receive((event) => {
				if (event.type === 'SYNC_LOG_READY') events.push(event)
			})
		})
	).start()
	actors.push(parent)
	const db = vi.fn<() => Dependencies['db']>()()
	const actor = createActor(
		createSyncLogMachine({ db }).provide({
			actors: {
				recordStart: fromPromise<void, SyncLogStart>(() => options.begin?.() ?? Promise.resolve()),
				recordResult: fromPromise<void, { start: SyncLogStart; result: SyncLogCompletion }>(
					({ input }) => options.finish?.(input.result) ?? Promise.resolve()
				)
			}
		}),
		{ input: options.input ?? input, parent }
	).start()
	return { actor, events }
}
it('reports readiness once and records the supplied financial result', async () => {
	const finish = vi.fn(async (_value: SyncLogCompletion) => {})
	const f = start({ finish })
	await waitFor(f.actor, (state) => state.matches('awaitingResult'))
	expect(f.events).toEqual([{ type: 'SYNC_LOG_READY', attemptId: input.id }])
	f.actor.send({ type: 'FINISH', result })
	expect(await toPromise(f.actor)).toEqual({ kind: 'recorded', attemptId: input.id, result })
	expect(finish).toHaveBeenCalledExactlyOnceWith(result)
})
it('rejects invalid starts before writing or signalling readiness', async () => {
	const begin = vi.fn(async () => {})
	const f = start({ begin, input: { ...input, organizationId: 'invalid' } })
	expect(await toPromise(f.actor)).toEqual({
		kind: 'notStarted',
		attemptId: input.id,
		reason: 'invalidStart'
	})
	expect(begin).not.toHaveBeenCalled()
	expect(f.events).toEqual([])
})
it('reports a failed start write without enabling provider work', async () => {
	const f = start({
		begin: async () => {
			throw new Error('write')
		}
	})
	expect(await toPromise(f.actor)).toEqual({
		kind: 'notStarted',
		attemptId: input.id,
		reason: 'startWriteFailed'
	})
	expect(f.events).toEqual([])
})
it('drains start persistence before recording cancellation and never signals readiness', async () => {
	const pending = Promise.withResolvers<void>()
	const finish = vi.fn(async (_value: SyncLogCompletion) => {})
	const f = start({ begin: () => pending.promise, finish })
	f.actor.send({ type: 'CANCEL' })
	expect(f.actor.getSnapshot().matches({ recordingStart: 'cancelling' })).toBe(true)
	expect(finish).not.toHaveBeenCalled()
	pending.resolve()
	const done = await toPromise(f.actor)
	expect(done).toMatchObject({
		kind: 'recorded',
		result: { outcome: 'cancelled', importSettlement: 'notStarted', importedCount: null }
	})
	expect(f.events).toEqual([])
})
it('waits for the operation to report its actual result after cancellation', async () => {
	const f = start()
	await waitFor(f.actor, (state) => state.matches('awaitingResult'))
	f.actor.send({ type: 'CANCEL' })
	expect(f.actor.getSnapshot().matches({ awaitingResult: 'cancelling' })).toBe(true)
	const cancelled: SyncLogCompletion = {
		...result,
		outcome: 'cancelled',
		importSettlement: 'unresolved'
	}
	f.actor.send({ type: 'FINISH', result: cancelled })
	expect(await toPromise(f.actor)).toEqual({
		kind: 'recorded',
		attemptId: input.id,
		result: cancelled
	})
})
it('drains result writes and ignores late replacement results', async () => {
	const pending = Promise.withResolvers<void>()
	const f = start({ finish: () => pending.promise })
	await waitFor(f.actor, (state) => state.matches('awaitingResult'))
	f.actor.send({ type: 'FINISH', result })
	f.actor.send({ type: 'CANCEL' })
	f.actor.send({ type: 'FINISH', result: { ...result, importedCount: 999 } })
	expect(f.actor.getSnapshot().matches('recordingResult')).toBe(true)
	pending.resolve()
	expect(await toPromise(f.actor)).toEqual({ kind: 'recorded', attemptId: input.id, result })
})
it('preserves the financial result when completion logging fails', async () => {
	const f = start({
		finish: async () => {
			throw new Error('write')
		}
	})
	await waitFor(f.actor, (state) => state.matches('awaitingResult'))
	f.actor.send({ type: 'FINISH', result })
	expect(await toPromise(f.actor)).toEqual({
		kind: 'resultUnrecorded',
		attemptId: input.id,
		result,
		reason: 'resultWriteFailed'
	})
})
it('rejects invalid completion times without attempting the terminal write', async () => {
	const finish = vi.fn(async (_value: SyncLogCompletion) => {})
	const f = start({ finish })
	await waitFor(f.actor, (state) => state.matches('awaitingResult'))
	const invalid = { ...result, finishedAt: new Date('2026-10-29T12:00:00Z') }
	f.actor.send({ type: 'FINISH', result: invalid })
	expect(await toPromise(f.actor)).toEqual({
		kind: 'resultUnrecorded',
		attemptId: input.id,
		result: invalid,
		reason: 'invalidResult'
	})
	expect(finish).not.toHaveBeenCalled()
})
