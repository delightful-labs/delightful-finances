import { describe, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createMergeJournalMachine } from './journal.js'
import { journalStorageActor } from './journal-storage.js'

function storage() {
	const factory: IDBFactory = {
		open: vi.fn(() => {
			throw new DOMException('private', 'SecurityError')
		}),
		deleteDatabase: vi.fn(),
		cmp: vi.fn(),
		databases: vi.fn(async () => [])
	}
	return { appId: 'test', factory }
}

describe('journal actor error boundaries and write policy', () => {
	it('settles a synchronous IndexedDB open failure instead of waiting for CLOSE', async () => {
		const input = storage()
		const actor = createActor(journalStorageActor, { input }).start()
		actor.send({ type: 'READ' })
		await expect(toPromise(actor)).resolves.toEqual({ type: 'ERROR', code: 'storage' })
		expect(input.factory.open).toHaveBeenCalledTimes(1)
		expect(actor.getSnapshot().context.db).toBeUndefined()
	})

	it('propagates acquisition failure through the journal owner with no raw error', async () => {
		const actor = createActor(createMergeJournalMachine(storage()), {
			input: { command: { type: 'LOAD' } }
		}).start()
		await expect(toPromise(actor)).resolves.toEqual({ outcome: 'failed', code: 'storage' })
		expect(actor.getSnapshot().context.command).toBeUndefined()
	})

	it('reports unavailable storage and rejects malformed commands without opening it', async () => {
		const unavailable = createActor(
			createMergeJournalMachine({ appId: 'test', factory: undefined }),
			{ input: { command: { type: 'LOAD' } } }
		).start()
		await expect(toPromise(unavailable)).resolves.toEqual({
			outcome: 'failed',
			code: 'unavailable'
		})
		const input = storage()
		const invalid = createActor(createMergeJournalMachine(input), {
			input: { command: { type: 'CREATE', journal: { secret: 'invalid' } } }
		}).start()
		await expect(toPromise(invalid)).resolves.toEqual({
			outcome: 'failed',
			code: 'invalid-journal'
		})
		expect(input.factory.open).not.toHaveBeenCalled()
	})
})
