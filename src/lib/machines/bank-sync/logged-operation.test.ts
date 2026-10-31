import { afterEach, expect, it, vi } from 'vitest'
import {
	createActor,
	fromCallback,
	fromPromise,
	toPromise,
	waitFor,
	type AnyActorRef
} from 'xstate'
import { createLoggedBankOperationMachine } from './logged-operation.js'
import { createSyncLogMachine } from './sync-log.js'
import { syncAttemptSchema } from '#lib/validation/bank-sync-log.js'
import { importFixture } from './import.fixture.js'
import { dependencies } from './test-fixtures.js'
import type {
	SyncLogStart,
	SyncLogCompletion,
	SyncLogAccountResult
} from '#lib/contracts/bank-sync-log.js'

const parents: AnyActorRef[] = []
afterEach(() => {
	vi.restoreAllMocks()
	for (const parent of parents.splice(0)) parent.stop()
})
function start(
	options: {
		begin?: (value: SyncLogStart) => Promise<void>
		finish?: (value: SyncLogCompletion) => Promise<void>
		command?: 'SYNC' | 'DISCOVER'
	} = {}
) {
	const f = importFixture(),
		deps = dependencies()
	const starts: SyncLogStart[] = [],
		results: SyncLogCompletion[] = []
	const accounts: SyncLogAccountResult[] = []
	const log = createSyncLogMachine(deps).provide({
		actors: {
			recordStart: fromPromise<void, SyncLogStart>(async ({ input }) => {
				starts.push(input)
				await options.begin?.(input)
			}),
			recordResult: fromPromise<void, { start: SyncLogStart; result: SyncLogCompletion }>(
				async ({ input }) => {
					results.push(input.result)
					await options.finish?.(input.result)
				}
			),
			recordAccount: fromPromise<
				void,
				{ id: string; values: SyncLogAccountResult & { attemptId: string; organizationId: string } }
			>(async ({ input }) => {
				accounts.push(input.values)
			})
		}
	})
	const parent = createActor(fromCallback(() => {})).start()
	parents.push(parent)
	const actor = createActor(
		createLoggedBankOperationMachine(deps).provide({ actors: { operation: f.operation, log } }),
		{ input: { command: { type: options.command ?? 'SYNC' }, discovered: [] }, parent }
	).start()
	return { ...f, actor, starts, results, accounts }
}
it('records the start before fetching, and records account results only after the lock is released', async () => {
	let ready = false
	const f = start({
		begin: async () => {
			ready = true
		}
	})
	f.fetch.mockImplementation(async () => {
		expect(ready).toBe(true)
		const { response } = await import('./import.fixture.js')
		return response
	})
	const result = await toPromise(f.actor)
	expect(result).toMatchObject({
		kind: 'complete',
		counts: { imported: 3 },
		logging: { kind: 'recorded' }
	})
	expect(f.starts).toHaveLength(1)
	expect(f.results).toMatchObject([
		{ outcome: 'succeeded', importedCount: 3, importSettlement: 'locallyPersisted' }
	])
	expect(f.accounts).toMatchObject([
		{ accountName: 'Checking', importedCount: 1 },
		{ accountName: 'Savings', importedCount: 2 }
	])
	expect(f.release).toHaveBeenCalledOnce()
})
it('prevents provider work when saving the start fails', async () => {
	const f = start({
		begin: async () => {
			throw new Error('write')
		}
	})
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'failed',
		logging: { kind: 'notStarted', reason: 'startWriteFailed' }
	})
	expect(f.fetch).not.toHaveBeenCalled()
	expect(f.unlock).not.toHaveBeenCalled()
	expect(f.acquire).not.toHaveBeenCalled()
})
it('drains start persistence on cancellation without fetching', async () => {
	const pending = Promise.withResolvers<void>()
	const f = start({ begin: () => pending.promise })
	await vi.waitFor(() => expect(f.starts).toHaveLength(1))
	f.actor.send({ type: 'CANCEL' })
	pending.resolve()
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'cancelled',
		logging: { kind: 'recorded', result: { outcome: 'cancelled', importSettlement: 'notStarted' } }
	})
	expect(f.fetch).not.toHaveBeenCalled()
})
it('waits for final logging after bank cleanup and preserves imports when the log write fails', async () => {
	const pending = Promise.withResolvers<void>()
	const f = start({ finish: () => pending.promise })
	await vi.waitFor(() => expect(f.results).toHaveLength(1))
	expect(f.release).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().status).toBe('active')
	f.actor.send({ type: 'CANCEL' })
	pending.reject(new Error('write'))
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'complete',
		counts: { imported: 3 },
		logging: { kind: 'resultUnrecorded', reason: 'resultWriteFailed' }
	})
	expect(f.fetch).toHaveBeenCalledOnce()
})
it('drains an issued import on cancellation and logs its actual partial counts', async () => {
	const pending = Promise.withResolvers<void>()
	const f = start()
	f.persist.mockResolvedValueOnce(undefined).mockReturnValueOnce(pending.promise)
	await vi.waitFor(() => expect(f.persist).toHaveBeenCalledTimes(2))
	f.actor.send({ type: 'CANCEL' })
	expect(f.release).not.toHaveBeenCalled()
	expect(f.results).toHaveLength(0)
	pending.resolve()
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'cancelled',
		counts: { imported: 2 },
		logging: { kind: 'recorded', result: { outcome: 'cancelled', importedCount: 2 } }
	})
	expect(f.release).toHaveBeenCalledOnce()
})
it('passes discovery through without creating a sync attempt', async () => {
	const f = start({ command: 'DISCOVER' })
	expect(await toPromise(f.actor)).toMatchObject({ kind: 'complete' })
	expect(f.starts).toHaveLength(0)
	expect(f.results).toHaveLength(0)
	expect(f.fetch).toHaveBeenCalledOnce()
})

it('contains an unexpected logging actor error before provider work', async () => {
	vi.spyOn(syncAttemptSchema, 'safeParse').mockImplementationOnce(() => {
		throw new Error('Unexpected log guard failure')
	})
	const f = start()
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'failed',
		logging: { kind: 'notStarted', reason: 'startWriteFailed' }
	})
	expect(f.fetch).not.toHaveBeenCalled()
	expect(f.acquire).not.toHaveBeenCalled()
})
it('preserves successful imports when the logging actor unexpectedly crashes at completion', async () => {
	const parse = syncAttemptSchema.safeParse.bind(syncAttemptSchema)
	vi.spyOn(syncAttemptSchema, 'safeParse')
		.mockImplementationOnce((value) => parse(value))
		.mockImplementationOnce(() => {
			throw new Error('Unexpected log guard failure')
		})
	const f = start()
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'complete',
		counts: { imported: 3 },
		logging: { kind: 'resultUnrecorded', reason: 'resultWriteFailed' }
	})
	expect(f.release).toHaveBeenCalledOnce()
	expect(f.fetch).toHaveBeenCalledOnce()
})
it('drains an issued import after the logging actor crashes, including later cancellation', async () => {
	const pending = Promise.withResolvers<void>(),
		f = start()
	f.persist.mockResolvedValueOnce(undefined).mockReturnValueOnce(pending.promise)
	await vi.waitFor(() => expect(f.persist).toHaveBeenCalledTimes(2))
	const log = f.actor.getSnapshot().children.log
	if (!log) throw new Error('Missing log actor')
	log.send({
		type: 'FINISH',
		result: {
			get outcome(): 'succeeded' {
				throw new Error('Unexpected log guard failure')
			},
			finishedAt: new Date(),
			importSettlement: 'locallyPersisted',
			failureCode: null,
			importedCount: 2,
			existingCount: 0,
			omittedCount: 0
		}
	})
	await waitFor(f.actor, (snapshot) => snapshot.matches({ logged: { operating: 'logFailed' } }))
	expect(f.release).not.toHaveBeenCalled()
	f.actor.send({ type: 'CANCEL' })
	expect(f.release).not.toHaveBeenCalled()
	pending.resolve()
	expect(await toPromise(f.actor)).toMatchObject({
		kind: 'cancelled',
		counts: { imported: 2 },
		logging: { kind: 'resultUnrecorded', result: { outcome: 'cancelled', importedCount: 2 } }
	})
	expect(f.release).toHaveBeenCalledOnce()
})
