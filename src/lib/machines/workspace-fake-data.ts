import { assign, sendTo, setup } from 'xstate'
import { PUBLIC_FAKE_DATA } from '$app/env/public'
import { fakeDataSetup, type FakeDataDb, type FakeDataResult } from './fake-data.js'
import type { WorkspacePersistenceEvent } from './workspace-creation-transaction.js'

type Input = {
	db: FakeDataDb
	userId: string
	organizationId: string
}
export type WorkspaceFakeDataResult = FakeDataResult
type Context = Input & { result: WorkspaceFakeDataResult | undefined }

/** Own the feature gate and seed lifecycle; preserve the seed outcome and settlement for the startup owner. */
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
			always: [
				{ guard: () => PUBLIC_FAKE_DATA === 'true', target: 'seeding' },
				{ target: 'skipped' }
			]
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
				onDone: [
					{
						guard: ({ event }) => event.output.outcome === 'seeded',
						target: 'seeded',
						actions: assign({ result: ({ event }) => event.output })
					},
					{
						guard: ({ event }) => event.output.outcome === 'skipped',
						target: 'skipped',
						actions: assign({ result: ({ event }) => event.output })
					},
					{
						guard: ({ event }) => event.output.outcome === 'cancelled',
						target: 'cancelled',
						actions: assign({ result: ({ event }) => event.output })
					},
					{
						guard: ({ event }) => event.output.outcome === 'closed',
						target: 'closed',
						actions: assign({ result: ({ event }) => event.output })
					},
					{ target: 'failed', actions: assign({ result: ({ event }) => event.output }) }
				],
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
		seeded: { type: 'final' },
		skipped: {
			type: 'final',
			entry: assign({
				result: ({ context }): WorkspaceFakeDataResult =>
					context.result ?? { outcome: 'skipped', settlement: 'notStarted' }
			})
		},
		cancelled: { type: 'final' },
		closed: { type: 'final' },
		failed: { type: 'final' }
	}
})
