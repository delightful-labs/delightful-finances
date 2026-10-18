import { describe, expect, it, vi } from 'vitest'
import { createActor, fromCallback, toPromise, type ActorRefFrom } from 'xstate'
import type { AccountMergeJournal, MergeJournalCommand } from '#lib/schema/account-merge-journal.js'
import type { JournalErrorCode, JournalTransactionInput } from '#lib/account-merge/journal.js'
import type { JournalStorageResult } from './journal-storage.js'
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
const destination = { identityId: id(4), organizationId: id(5) }

// Resource adapters are controlled; the production storage statechart still owns
// opening, transaction selection, cancellation settlement and connection closing.
const database: IDBDatabase = {
	name: 'controlled',
	version: 1,
	objectStoreNames: {
		length: 0,
		contains: () => false,
		item: () => null,
		[Symbol.iterator]: () => [][Symbol.iterator]()
	},
	onabort: null,
	onclose: null,
	onerror: null,
	onversionchange: null,
	close: vi.fn(),
	createObjectStore: vi.fn(),
	deleteObjectStore: vi.fn(),
	transaction: vi.fn(),
	addEventListener: vi.fn(),
	removeEventListener: vi.fn(),
	dispatchEvent: vi.fn()
}
type Access = {
	resolve: (result: JournalStorageResult) => void
	disposed: boolean
	cancelled: boolean
}
function controlled(command: MergeJournalCommand, failAt?: number) {
	const accesses: Access[] = []
	type ConnectionCommand = { type: 'OPEN'; factory: IDBFactory; name: string } | { type: 'CLOSE' }
	const connection = fromCallback<ConnectionCommand>(({ receive, sendBack }) => {
		receive((event) =>
			sendBack(event.type === 'OPEN' ? { type: 'OPENED', db: database } : { type: 'CLOSED' })
		)
	})
	const transaction = fromCallback<{ type: 'CANCEL' }, JournalTransactionInput>(
		({ receive, sendBack }) => {
			if (accesses.length === failAt) throw new Error('private storage failure')
			const access: Access = {
				disposed: false,
				cancelled: false,
				resolve: (result) =>
					sendBack(
						result.type === 'ERROR'
							? { type: 'TRANSACTION_ERROR', code: result.code }
							: { type: 'SETTLED', journal: result.journal }
					)
			}
			accesses.push(access)
			receive(() => {
				access.cancelled = true
			})
			return () => {
				access.disposed = true
			}
		}
	)
	const machine = createMergeJournalMachine(storage()).provide({
		actors: {
			storage: journalStorageActor.provide({
				actors: { connection, read: transaction, replace: transaction, remove: transaction }
			})
		}
	})
	const actor = createActor(machine, { input: { command } }).start()
	const result = toPromise(actor)
	async function settle(index: number, value: JournalStorageResult) {
		await vi.waitFor(() => expect(accesses.length).toBeGreaterThan(index))
		accesses[index]?.resolve(value)
		await Promise.resolve()
		await Promise.resolve()
	}
	return { actor, result, accesses, settle }
}
function cleared(actor: ActorRefFrom<ReturnType<typeof createMergeJournalMachine>>) {
	expect(actor.getSnapshot().context).toMatchObject({
		command: undefined,
		current: null,
		next: null
	})
}

describe('consolidated journal public commands', () => {
	it.each([
		{ name: 'load', command: { type: 'LOAD' }, current: journal },
		{
			name: 'already absent discard',
			command: { type: 'DISCARD', operationId: journal.operationId },
			current: null
		}
	] satisfies {
		name: string
		command: MergeJournalCommand
		current: AccountMergeJournal | null
	}[])('finishes $name without starting a write', async ({ command, current }) => {
		const run = controlled(command)
		await run.settle(0, { type: 'READ', journal: current })
		await expect(run.result).resolves.toEqual({ outcome: 'completed', journal: current })
		expect(run.accesses).toHaveLength(1)
		cleared(run.actor)
	})

	it.each([
		{ name: 'existing creation', command: { type: 'CREATE', journal }, current: journal },
		{
			name: 'prebound creation',
			command: { type: 'CREATE', journal: { ...journal, destination } },
			current: null
		},
		{
			name: 'stale bind',
			command: { type: 'BIND', operationId: id(9), destination },
			current: journal
		},
		{ name: 'stale discard', command: { type: 'DISCARD', operationId: id(9) }, current: journal },
		{
			name: 'missing bind',
			command: { type: 'BIND', operationId: journal.operationId, destination },
			current: null
		},
		{
			name: 'identity retarget',
			command: {
				type: 'BIND',
				operationId: journal.operationId,
				destination: { ...destination, identityId: id(9) }
			},
			current: { ...journal, destination }
		},
		{
			name: 'workspace retarget',
			command: {
				type: 'BIND',
				operationId: journal.operationId,
				destination: { ...destination, organizationId: id(9) }
			},
			current: { ...journal, destination }
		}
	] satisfies {
		name: string
		command: MergeJournalCommand
		current: AccountMergeJournal | null
	}[])('rejects $name without starting a write', async ({ command, current }) => {
		const run = controlled(command)
		await run.settle(0, { type: 'READ', journal: current })
		await expect(run.result).resolves.toEqual({ outcome: 'conflict', code: 'conflict' })
		expect(run.accesses).toHaveLength(1)
		cleared(run.actor)
	})

	it.each(['CREATE', 'BIND', 'DISCARD'] satisfies MergeJournalCommand['type'][])(
		'waits for %s persistence before completion',
		async (type) => {
			const command: MergeJournalCommand =
				type === 'CREATE'
					? { type, journal }
					: type === 'BIND'
						? { type, operationId: journal.operationId, destination }
						: { type, operationId: journal.operationId }
			const run = controlled(command)
			await run.settle(0, { type: 'READ', journal: type === 'CREATE' ? null : journal })
			await vi.waitFor(() => expect(run.accesses).toHaveLength(2))
			expect(run.actor.getSnapshot().status).toBe('active')
			const saved =
				type === 'DISCARD' ? null : type === 'BIND' ? { ...journal, destination } : journal
			await run.settle(1, { type: 'WRITTEN', journal: saved })
			await expect(run.result).resolves.toEqual({ outcome: 'completed', journal: saved })
			cleared(run.actor)
		}
	)

	it.each(['conflict', 'storage'] satisfies JournalErrorCode[])(
		'propagates write %s',
		async (code) => {
			const run = controlled({ type: 'CREATE', journal })
			await run.settle(0, { type: 'READ', journal: null })
			await run.settle(1, { type: 'ERROR', code })
			await expect(run.result).resolves.toEqual({
				outcome: code === 'conflict' ? 'conflict' : 'failed',
				code
			})
			cleared(run.actor)
		}
	)

	it.each(['CANCEL', 'SHUTDOWN'] satisfies ('CANCEL' | 'SHUTDOWN')[])(
		'keeps reading alive until %s settles',
		async (type) => {
			const run = controlled({ type: 'LOAD' })
			run.actor.send({ type })
			expect(run.actor.getSnapshot().status).toBe('active')
			expect(run.accesses[0]?.disposed).toBe(false)
			expect(run.accesses[0]?.cancelled).toBe(true)
			await run.settle(0, { type: 'READ', journal })
			await expect(run.result).resolves.toEqual({
				outcome: type === 'CANCEL' ? 'cancelled' : 'closed'
			})
			expect(run.accesses).toHaveLength(1)
			cleared(run.actor)
		}
	)

	it.each([
		{ stop: 'CANCEL', commit: false },
		{ stop: 'CANCEL', commit: true },
		{ stop: 'SHUTDOWN', commit: false },
		{ stop: 'SHUTDOWN', commit: true }
	] satisfies { stop: 'CANCEL' | 'SHUTDOWN'; commit: boolean }[])(
		'settles $stop with commit=$commit without stopping storage early',
		async ({ stop, commit }) => {
			const run = controlled({ type: 'CREATE', journal })
			await run.settle(0, { type: 'READ', journal: null })
			await vi.waitFor(() => expect(run.accesses).toHaveLength(2))
			run.actor.send({ type: stop })
			run.actor.send({ type: 'CANCEL' })
			expect(run.actor.getSnapshot().status).toBe('active')
			expect(run.accesses[1]?.disposed).toBe(false)
			expect(run.accesses[1]?.cancelled).toBe(true)
			await run.settle(
				1,
				commit ? { type: 'WRITTEN', journal } : { type: 'ERROR', code: 'cancelled' }
			)
			await expect(run.result).resolves.toEqual(
				commit
					? { outcome: 'partial', journal, reason: stop === 'CANCEL' ? 'cancelled' : 'shutdown' }
					: { outcome: stop === 'CANCEL' ? 'cancelled' : 'closed' }
			)
			cleared(run.actor)
		}
	)

	it('gives shutdown priority after cancellation while a commit settles', async () => {
		const run = controlled({ type: 'CREATE', journal })
		await run.settle(0, { type: 'READ', journal: null })
		await vi.waitFor(() => expect(run.accesses).toHaveLength(2))
		run.actor.send({ type: 'CANCEL' })
		run.actor.send({ type: 'SHUTDOWN' })
		run.actor.send({ type: 'CANCEL' })
		await run.settle(1, { type: 'WRITTEN', journal })
		await expect(run.result).resolves.toEqual({ outcome: 'partial', journal, reason: 'shutdown' })
		cleared(run.actor)
	})

	it.each([0, 1])(
		'supervises unexpected transaction startup failure during access %s',
		async (index) => {
			const run = controlled({ type: 'CREATE', journal }, index)
			if (index === 1) await run.settle(0, { type: 'READ', journal: null })
			await expect(run.result).resolves.toEqual({ outcome: 'failed', code: 'storage' })
			cleared(run.actor)
		}
	)
})
