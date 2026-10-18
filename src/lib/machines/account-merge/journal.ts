import { raise, sendTo, setup } from 'xstate'
import type {
	AccountMergeJournal,
	MergeJournalCommand
} from '../../schema/account-merge-journal.js'
import { mergeJournalCommandSchema } from '../../validation/account-merge-journal.js'
import { type JournalErrorCode, type MergeJournalStorage } from '../../account-merge/journal.js'
import { required } from '../bank-sync/identity.js'
import { journalStorageActor } from './journal-storage.js'

type Result =
	| { outcome: 'completed'; journal: AccountMergeJournal | null }
	| { outcome: 'cancelled' | 'closed' }
	| { outcome: 'partial'; journal: AccountMergeJournal | null; reason: 'cancelled' | 'shutdown' }
	| { outcome: 'failed' | 'conflict'; code: JournalErrorCode }
type Event =
	| { type: 'READ'; journal: AccountMergeJournal | null }
	| { type: 'WRITTEN'; journal: AccountMergeJournal | null }
	| { type: 'ERROR'; code: JournalErrorCode }
	| { type: 'CANCEL' | 'SHUTDOWN' }
type Context = {
	command: MergeJournalCommand | undefined
	current: AccountMergeJournal | null
	next: AccountMergeJournal | null
	error: JournalErrorCode
	result: Result | undefined
}

export function createMergeJournalMachine(storage: MergeJournalStorage) {
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
		{ command: unknown },
		Result
	>({ actors })
	const remember = workflow.assign({
		current: ({ context, event }) => ('journal' in event ? event.journal : context.current)
	})
	const abort = workflow.sendTo('storage', { type: 'CANCEL' })
	const finish = (result: (context: Context) => Result) =>
		({
			type: 'final',
			entry: workflow.assign({
				result: ({ context }) => result(context),
				command: undefined,
				current: null,
				next: null
			})
		}) satisfies { type: 'final'; entry: unknown }
	const access = workflow.createStateConfig({
		invoke: {
			id: 'storage',
			src: 'storage',
			input: () => storage,
			onDone: { actions: raise(({ event }) => event.output) },
			onError: { actions: raise({ type: 'ERROR', code: 'storage' }) }
		}
	})
	// These states remain inside the access owner, so cancellation cannot stop
	// storage before its transaction has reported commit or abort settlement.
	const settlement = {
		cancelling: workflow.createStateConfig({
			on: {
				READ: '#account-merge-journal.cancelled',
				ERROR: '#account-merge-journal.cancelled',
				WRITTEN: { target: '#account-merge-journal.partial', actions: remember },
				CANCEL: {},
				SHUTDOWN: 'closing'
			}
		}),
		closing: workflow.createStateConfig({
			on: {
				READ: '#account-merge-journal.closed',
				ERROR: '#account-merge-journal.closed',
				WRITTEN: { target: '#account-merge-journal.partialShutdown', actions: remember },
				CANCEL: {},
				SHUTDOWN: {}
			}
		})
	}

	return workflow.createMachine({
		id: 'account-merge-journal',
		context: ({ input }) => {
			const parsed = mergeJournalCommandSchema.safeParse(input.command)
			return {
				command: parsed.success ? parsed.data : undefined,
				current: null,
				next: null,
				error: 'invalid-journal',
				result: undefined
			}
		},
		initial: 'validating',
		output: ({ context }) => required(context.result),
		on: { CANCEL: '.cancelled', SHUTDOWN: '.closed' },
		states: {
			validating: {
				always: [
					{ guard: ({ context }) => !context.command, target: 'failed' },
					{ target: 'reading' }
				]
			},
			reading: {
				...access,
				initial: 'active',
				states: { active: { entry: sendTo('storage', { type: 'READ' }) }, ...settlement },
				on: {
					READ: { target: 'deciding', actions: remember },
					ERROR: {
						target: 'failed',
						actions: workflow.assign({
							error: ({ context, event }) => (event.type === 'ERROR' ? event.code : context.error)
						})
					},
					CANCEL: { target: '.cancelling', actions: abort },
					SHUTDOWN: { target: '.closing', actions: abort }
				}
			},
			deciding: {
				always: [
					{ guard: ({ context }) => context.command?.type === 'LOAD', target: 'completed' },
					{
						guard: ({ context }) =>
							context.command?.type === 'CREATE' &&
							(context.current !== null || context.command.journal.destination !== null),
						target: 'conflicted'
					},
					{
						guard: ({ context }) =>
							(context.command?.type === 'BIND' || context.command?.type === 'DISCARD') &&
							context.current !== null &&
							context.current.operationId !== context.command.operationId,
						target: 'conflicted'
					},
					{
						guard: ({ context }) => context.command?.type === 'BIND' && context.current === null,
						target: 'conflicted'
					},
					{
						guard: ({ context }) =>
							context.command?.type === 'BIND' &&
							context.current?.destination != null &&
							(context.current.destination.identityId !== context.command.destination.identityId ||
								context.current.destination.organizationId !==
									context.command.destination.organizationId),
						target: 'conflicted'
					},
					{
						guard: ({ context }) => context.command?.type === 'DISCARD' && context.current === null,
						target: 'completed'
					},
					{
						target: 'writing',
						actions: workflow.assign({
							next: ({ context }) => {
								if (context.command?.type === 'CREATE') return context.command.journal
								if (context.command?.type === 'BIND')
									return { ...required(context.current), destination: context.command.destination }
								return null
							}
						})
					}
				]
			},
			writing: {
				...access,
				initial: 'choosingWrite',
				states: {
					choosingWrite: {
						always: [
							{ guard: ({ context }) => context.next === null, target: 'removing' },
							{ target: 'replacing' }
						]
					},
					replacing: {
						entry: sendTo('storage', ({ context }) => ({
							type: 'REPLACE',
							expected: context.current,
							journal: required(context.next)
						}))
					},
					removing: {
						entry: sendTo('storage', ({ context }) => ({
							type: 'REMOVE',
							expected: context.current
						}))
					},
					...settlement
				},
				on: {
					WRITTEN: { target: 'completed', actions: remember },
					ERROR: [
						{ guard: ({ event }) => event.code === 'conflict', target: 'conflicted' },
						{
							target: 'failed',
							actions: workflow.assign({
								error: ({ context, event }) => (event.type === 'ERROR' ? event.code : context.error)
							})
						}
					],
					CANCEL: { target: '.cancelling', actions: abort },
					SHUTDOWN: { target: '.closing', actions: abort }
				}
			},

			completed: finish((context) => ({ outcome: 'completed', journal: context.current })),
			cancelled: finish(() => ({ outcome: 'cancelled' })),
			closed: finish(() => ({ outcome: 'closed' })),
			partial: finish((context) => ({
				outcome: 'partial',
				journal: context.current,
				reason: 'cancelled'
			})),
			partialShutdown: finish((context) => ({
				outcome: 'partial',
				journal: context.current,
				reason: 'shutdown'
			})),
			conflicted: finish(() => ({ outcome: 'conflict', code: 'conflict' })),
			failed: finish((context) => ({ outcome: 'failed', code: context.error }))
		}
	})
}
