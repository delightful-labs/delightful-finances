import { fromCallback } from 'xstate'
import type { AccountMergeJournal } from '../schema/account-merge-journal.js'
import { accountMergeJournalSchema } from '../validation/account-merge-journal.js'

export type JournalErrorCode =
	'unavailable' | 'blocked' | 'storage' | 'invalid-journal' | 'conflict' | 'cancelled'

export type MergeJournalStorage = { appId: string; factory: IDBFactory | undefined }
export function createMergeJournalStore(
	appId: string,
	factory: IDBFactory | undefined = globalThis.indexedDB
): MergeJournalStorage {
	return { appId, factory }
}

const storeName = 'operations'
const pendingKey = 'pending'

type ConnectionCommand = { type: 'OPEN'; factory: IDBFactory; name: string } | { type: 'CLOSE' }
export type ConnectionEvent =
	| { type: 'OPENED'; db: IDBDatabase }
	| { type: 'CONNECTION_ERROR'; code: JournalErrorCode }
	| { type: 'CLOSED' }

// Browser resource ownership only. Pending open requests cannot be aborted;
// their handlers remain responsible for closing a connection that arrives late.
export const journalConnectionActor = fromCallback<ConnectionCommand>(({ receive, sendBack }) => {
	let released = false
	let db: IDBDatabase | undefined
	const close = () => {
		released = true
		db?.close()
	}
	receive((event) => {
		if (event.type === 'CLOSE') {
			close()
			sendBack({ type: 'CLOSED' } satisfies ConnectionEvent)
			return
		}
		// Opening can throw before a resource exists; invoke.onError owns that failure.
		const request = event.factory.open(event.name, 1)
		request.onupgradeneeded = () => {
			if (released) request.transaction?.abort()
			else request.result.createObjectStore(storeName)
		}
		request.onblocked = () => {
			if (!released)
				sendBack({ type: 'CONNECTION_ERROR', code: 'blocked' } satisfies ConnectionEvent)
			released = true
		}
		request.onerror = () => {
			if (!released)
				sendBack({ type: 'CONNECTION_ERROR', code: 'storage' } satisfies ConnectionEvent)
		}
		request.onsuccess = () => {
			db = request.result
			db.onversionchange = () => db?.close()
			if (released) db.close()
			else sendBack({ type: 'OPENED', db } satisfies ConnectionEvent)
		}
	})
	return close
})

export type JournalTransactionInput = {
	db: IDBDatabase
	expected: AccountMergeJournal | null
	next: AccountMergeJournal | null
}
export type JournalTransactionEvent =
	| { type: 'SETTLED'; journal: AccountMergeJournal | null }
	| { type: 'TRANSACTION_ERROR'; code: JournalErrorCode }

// Keep request callbacks synchronous so comparison and mutation share one IDB turn.
function transactionActor(
	mode: IDBTransactionMode,
	perform: (
		input: JournalTransactionInput,
		current: AccountMergeJournal | null,
		store: IDBObjectStore
	) => AccountMergeJournal | null
) {
	return fromCallback<{ type: 'CANCEL' }, JournalTransactionInput>(
		({ input, receive, sendBack }) => {
			// Acquisition failures are handled by invoke.onError before cleanup is needed.
			const transaction = input.db.transaction(storeName, mode, { durability: 'strict' })
			let result: { journal: AccountMergeJournal | null } | undefined
			let failure: JournalErrorCode = 'storage'
			const abort = () => {
				try {
					transaction.abort()
				} catch {
					/* A completed commit cannot be undone. */
				}
			}
			receive(() => {
				failure = 'cancelled'
				abort()
			})
			// Native request setup can throw after acquisition: abort and wait for onabort.
			try {
				transaction.oncomplete = () =>
					sendBack(
						result
							? ({ type: 'SETTLED', journal: result.journal } satisfies JournalTransactionEvent)
							: ({ type: 'TRANSACTION_ERROR', code: 'storage' } satisfies JournalTransactionEvent)
					)
				transaction.onabort = () =>
					sendBack({ type: 'TRANSACTION_ERROR', code: failure } satisfies JournalTransactionEvent)
				const store = transaction.objectStore(storeName)
				const request = store.get(pendingKey)
				request.onsuccess = () => {
					try {
						const value: unknown = request.result
						const parsed = value === undefined ? null : accountMergeJournalSchema.safeParse(value)
						if (parsed !== null && !parsed.success) {
							failure = 'invalid-journal'
							abort()
							return
						}
						const current = parsed === null ? null : parsed.data
						// Atomic race protection for policy already checked by the write actor.
						if (
							mode === 'readwrite' &&
							JSON.stringify(current) !== JSON.stringify(input.expected)
						) {
							failure = 'conflict'
							abort()
							return
						}
						result = { journal: perform(input, current, store) }
					} catch {
						failure = 'storage'
						abort()
					}
				}
			} catch {
				failure = 'storage'
				abort()
			}
			return abort
		}
	)
}

export const readJournalActor = transactionActor('readonly', (_input, current) => current)
export const replaceJournalActor = transactionActor('readwrite', (input, _current, store) => {
	const journal = accountMergeJournalSchema.parse(input.next)
	store.put(journal, pendingKey)
	return journal
})
export const removeJournalActor = transactionActor('readwrite', (_input, _current, store) => {
	store.delete(pendingKey)
	return null
})
