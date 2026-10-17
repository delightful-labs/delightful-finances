import { raise, setup } from 'xstate'
import type { AccountMergeJournal } from '../../schema/account-merge-journal.js'
import type { JournalErrorCode, MergeJournalStorage } from '../../account-merge/journal.js'
import { journalStorageActor, type JournalStorageResult } from './journal-storage.js'
import { required } from '../bank-sync/identity.js'

type Work = { expected: AccountMergeJournal | null; next: AccountMergeJournal | null }
type Result = Exclude<JournalStorageResult, { type: 'READ' }>
type Event = JournalStorageResult | ({ type: 'WRITE' } & Work) | { type: 'CANCEL' }
type Context = { work: Work | undefined; result: Result | undefined }

export function createJournalWriteMachine(storage: MergeJournalStorage) {
	const actors = { storage: journalStorageActor }
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		undefined,
		Result
	>({ actors })
	const finish = (code: JournalErrorCode) =>
		({
			type: 'final',
			entry: workflow.assign({
				result: () => ({ type: 'ERROR', code }) satisfies Result,
				work: undefined
			})
		}) satisfies { type: 'final'; entry: unknown }
	const abort = workflow.sendTo('storage', { type: 'CANCEL' })
	return workflow.createMachine({
		id: 'account-merge-journal-write',
		initial: 'waiting',
		context: { work: undefined, result: undefined },
		invoke: {
			id: 'storage',
			src: 'storage',
			input: () => storage,
			onDone: { actions: raise(({ event }) => event.output) },
			onError: { actions: raise({ type: 'ERROR', code: 'storage' }) }
		},
		output: ({ context }) => required(context.result),
		states: {
			waiting: {
				on: {
					WRITE: {
						target: 'checkingCreation',
						actions: workflow.assign({
							work: ({ context, event }) =>
								event.type === 'WRITE'
									? { expected: event.expected, next: event.next }
									: context.work
						})
					}
				}
			},
			checkingCreation: {
				always: [
					{
						guard: ({ context }) =>
							context.work?.expected === null && context.work.next?.destination != null,
						target: 'conflicted'
					},
					{ target: 'checkingOrigin' }
				]
			},
			checkingOrigin: {
				always: [
					{
						guard: ({ context }) => {
							const { expected, next } = required(context.work)
							return (
								expected !== null &&
								next !== null &&
								(expected.operationId !== next.operationId ||
									JSON.stringify(expected.snapshot) !== JSON.stringify(next.snapshot))
							)
						},
						target: 'conflicted'
					},
					{ target: 'checkingDestination' }
				]
			},
			checkingDestination: {
				always: [
					{
						guard: ({ context }) => {
							const { expected, next } = required(context.work)
							return (
								expected?.destination != null &&
								next !== null &&
								JSON.stringify(expected.destination) !== JSON.stringify(next.destination)
							)
						},
						target: 'conflicted'
					},
					{ target: 'choosingWrite' }
				]
			},
			choosingWrite: {
				always: [
					{ guard: ({ context }) => context.work?.next === null, target: 'removing' },
					{ target: 'replacing' }
				]
			},
			replacing: {
				entry: workflow.sendTo('storage', ({ context }) => ({
					type: 'REPLACE',
					expected: required(context.work).expected,
					journal: required(required(context.work).next)
				})),
				on: { CANCEL: { target: 'cancelling', actions: abort } }
			},
			removing: {
				entry: workflow.sendTo('storage', ({ context }) => ({
					type: 'REMOVE',
					expected: required(context.work).expected
				})),
				on: { CANCEL: { target: 'cancelling', actions: abort } }
			},
			cancelling: { on: { CANCEL: {} } },
			conflicted: finish('conflict'),
			cancelled: finish('cancelled'),
			written: { type: 'final' },
			failed: { type: 'final' }
		},
		// The selected effect is the only source of a committed-write result.
		on: {
			CANCEL: '.cancelled',
			WRITTEN: {
				target: '.written',
				actions: workflow.assign({
					result: ({ context, event }) => (event.type === 'WRITTEN' ? event : context.result),
					work: undefined
				})
			},
			ERROR: [
				{ guard: ({ event }) => event.code === 'conflict', target: '.conflicted' },
				{ guard: ({ event }) => event.code === 'cancelled', target: '.cancelled' },
				{
					target: '.failed',
					actions: workflow.assign({
						result: ({ context, event }) => (event.type === 'ERROR' ? event : context.result),
						work: undefined
					})
				}
			]
		}
	})
}
