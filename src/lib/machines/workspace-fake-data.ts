import { assign, sendTo, setup } from 'xstate'
import { PUBLIC_FAKE_DATA } from '$app/env/public'
import { fakeDataSetup, type FakeDataDb, type FakeDataResult } from './fake-data.js'
import type { WorkspacePersistenceEvent } from './workspace-creation-transaction.js'

type Input = {
	db: FakeDataDb
	userId: string
	organizationId: string
	profileId: string
}
export type WorkspaceFakeDataResult =
	| { outcome: 'ready'; profileId: string }
	| { outcome: 'failed'; settlement: 'notStarted' | 'unresolved'; error: unknown }
	| {
			outcome: 'cancelled' | 'closed'
			settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
	  }
type Context = Input & { result: WorkspaceFakeDataResult | undefined }

/** Translate the seed outcome once, preserving confirmation when shutdown follows commit. */
function initializationResult(result: FakeDataResult, profileId: string): WorkspaceFakeDataResult {
	if (result.outcome === 'seeded' || result.outcome === 'skipped')
		return { outcome: 'ready', profileId }
	if (result.outcome === 'failed') return result
	return {
		outcome: result.outcome,
		settlement: result.settlement === 'confirmed' ? 'locallyPersisted' : result.settlement
	}
}

/** Own the feature gate and seed lifecycle; expose only the initialization result to the parent. */
export const workspaceFakeData = setup<
	Context,
	WorkspacePersistenceEvent,
	{ seed: typeof fakeDataSetup },
	{},
	{},
	{},
	never,
	string,
	Input,
	WorkspaceFakeDataResult
>({ actors: { seed: fakeDataSetup } }).createMachine({
	id: 'workspace-fake-data',
	context: ({ input }) => ({ ...input, result: undefined }),
	initial: 'checking',
	output: ({ context }) => {
		if (!context.result) throw new Error('Missing workspace fake-data result')
		return context.result
	},
	states: {
		checking: {
			always: [{ guard: () => PUBLIC_FAKE_DATA === 'true', target: 'seeding' }, { target: 'ready' }]
		},
		seeding: {
			on: {
				CANCEL: { actions: sendTo('seed', { type: 'CANCEL' }) },
				SHUTDOWN: { actions: sendTo('seed', { type: 'SHUTDOWN' }) }
			},
			invoke: {
				id: 'seed',
				src: 'seed',
				input: ({ context }) => context,
				onDone: {
					target: 'completed',
					actions: assign({
						result: ({ context, event }) => initializationResult(event.output, context.profileId)
					})
				},
				onError: {
					target: 'failed',
					actions: assign({
						result: ({ event }): WorkspaceFakeDataResult => ({
							outcome: 'failed',
							settlement: 'unresolved',
							error: event.error
						})
					})
				}
			}
		},
		ready: {
			type: 'final',
			entry: assign({
				result: ({ context }): WorkspaceFakeDataResult => ({
					outcome: 'ready',
					profileId: context.profileId
				})
			})
		},
		completed: { type: 'final' },
		failed: { type: 'final' }
	}
})
