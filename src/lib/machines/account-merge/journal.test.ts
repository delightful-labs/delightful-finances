import { describe, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createMergeJournalMachine } from './journal.js'
import { createJournalWriteMachine } from './journal-write.js'
import { journalStorageActor } from './journal-storage.js'
import type { AccountMergeJournal } from '#lib/schema/account-merge-journal.js'

const id = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`
const journal: AccountMergeJournal = {
	version: 1,
	operationId: id(1),
	destination: null,
	snapshot: {
		version: 1,
		sourceIdentityId: id(2),
		sourceOrganization: {
			id: id(3),
			ownerId: id(2),
			name: 'Personal',
			kind: 'personal',
			defaultCurrency: 'USD'
		},
		accounts: [],
		categories: [],
		tags: [],
		transactions: [],
		checkDetails: [],
		transactionTags: [],
		transactionBatches: [],
		batchTemplates: [],
		bankAccountLinks: [],
		transactionAttachments: [],
		excludedConnectionCount: 0
	}
}
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

	it.each([
		{
			name: 'prebound creation',
			expected: null,
			next: { ...journal, destination: { identityId: id(4), organizationId: id(5) } }
		},
		{ name: 'operation replacement', expected: journal, next: { ...journal, operationId: id(6) } },
		{
			name: 'snapshot replacement',
			expected: journal,
			next: { ...journal, snapshot: { ...journal.snapshot, excludedConnectionCount: 1 } }
		},
		{
			name: 'destination replacement',
			expected: { ...journal, destination: { identityId: id(4), organizationId: id(5) } },
			next: { ...journal, destination: { identityId: id(6), organizationId: id(7) } }
		},
		{
			name: 'destination removal',
			expected: { ...journal, destination: { identityId: id(4), organizationId: id(5) } },
			next: journal
		}
	])('rejects $name before any storage effect', async ({ expected, next }) => {
		const input = storage()
		const actor = createActor(createJournalWriteMachine(input)).start()
		actor.send({ type: 'WRITE', expected, next })
		await expect(toPromise(actor)).resolves.toEqual({ type: 'ERROR', code: 'conflict' })
		expect(input.factory.open).not.toHaveBeenCalled()
		expect(actor.getSnapshot().context.work).toBeUndefined()
	})
})
