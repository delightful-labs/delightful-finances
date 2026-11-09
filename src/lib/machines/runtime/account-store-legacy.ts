import { setup, types, createAsyncLogic } from 'xstate-v6'
import { accountStoreLock, type AccountLockInput } from './account-store-lock.js'
import { definitelyNotIssued, type AccountStoreStorage } from './account-store-contracts.js'
import {
	parseAccountSelection,
	hasDroppedAccountRoots,
	withoutDroppedAccountRoots,
	type AccountSelection
} from '../../runtime/worker/account-selection.js'

type Input = {
	key: string
	dropped: string[]
	locks: AccountLockInput['locks']
	storage: AccountStoreStorage
}
type Context = { input: Input | undefined; selection: AccountSelection | undefined; clean: boolean }
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Account cleanup resource unavailable')
	return value
}
const actors = {
	lock: accountStoreLock,
	read: createAsyncLogic({
		run: async ({ input }: { input: Input }) =>
			parseAccountSelection(await input.storage.readEarlier(input.key))
	}),
	write: createAsyncLogic({
		run: ({ input }: { input: { storage: AccountStoreStorage; key: string; value: string } }) =>
			input.storage.writeEarlier(input.key, input.value)
	}),
	drain: createAsyncLogic({
		run: ({ input }: { input: AccountStoreStorage }) => input.closeHostAndDrain()
	})
}
const model = setup({
	schemas: {
		context: types<Context>(),
		input: types<Input>(),
		output: types<boolean>(),
		events: {
			LOCKED: types(),
			RELEASED: types(),
			LOCK_FAILED: types(),
			HOST_CLOSED: types<{ scope: string }>()
		},
		children: {
			lock: types<import('xstate-v6').ActorRefFrom<typeof actors.lock>>(),
			read: types<import('xstate-v6').ActorRefFrom<typeof actors.read>>(),
			write: types<import('xstate-v6').ActorRefFrom<typeof actors.write>>(),
			drain: types<import('xstate-v6').ActorRefFrom<typeof actors.drain>>()
		}
	},
	states: {
		acquiring: {},
		reading: {},
		writing: { schemas: { context: types<{ selection: AccountSelection }>() } },
		draining: {},
		retained: {},
		releasing: {},
		failedRelease: {},
		done: { type: 'final' }
	},
	actors,
	guards: {
		needsScrub: (_, params: { selection: AccountSelection; dropped: string[] }) =>
			hasDroppedAccountRoots(params.selection, params.dropped),
		definitelyNotIssued: (_, params: { error: unknown }) => definitelyNotIssued(params.error)
	}
})
/** Primary selection is already acknowledged. This child owns the earlier key
 * until scrub or failed-host drain settles; its failure never rewrites primary. */
export const accountStoreLegacyMachine = model.createMachine({
	id: 'finance-account-store-legacy',
	initial: 'acquiring',
	context: ({ input }) => ({ input, selection: undefined, clean: false }),
	output: ({ context }) => context.clean,
	invoke: {
		id: 'lock',
		src: 'lock',
		input: ({ context }) => {
			const input = required(context.input)
			return { key: input.key, locks: input.locks }
		}
	},
	on: {
		LOCK_FAILED: { target: '.done' },
		HOST_CLOSED: ({ context, event }) => {
			if (event.scope !== required(context.input).storage.scope) return
			return { target: '.failedRelease' }
		}
	},
	onError: { target: '.draining' },
	states: {
		acquiring: { on: { LOCKED: { target: 'reading' } } },
		reading: {
			invoke: {
				id: 'read',
				src: 'read',
				input: ({ context }) => required(context.input),
				onDone: (args) => {
					const value = args.event.output
					if (
						value &&
						args.guards.needsScrub(args, {
							selection: value,
							dropped: required(args.context.input).dropped
						})
					)
						return { target: 'writing', context: { selection: value } }
					return { target: 'releasing' }
				},
				onError: { target: 'failedRelease' }
			}
		},
		writing: {
			invoke: {
				id: 'write',
				src: 'write',
				input: ({ context }) => {
					const input = required(context.input)
					return {
						storage: input.storage,
						key: input.key,
						value: withoutDroppedAccountRoots(context.selection, input.dropped)
					}
				},
				onDone: { target: 'releasing' },
				onError: (args) => {
					if (args.guards.definitelyNotIssued(args, args.event)) return { target: 'failedRelease' }
					return { target: 'draining' }
				}
			}
		},
		draining: {
			invoke: {
				id: 'drain',
				src: 'drain',
				input: ({ context }) => required(context.input).storage,
				onDone: { target: 'failedRelease' },
				onError: { target: 'retained' }
			}
		},
		retained: {},
		releasing: {
			entry: (_, enq) => {
				enq.sendTo('lock', { type: 'RELEASE' })
			},
			on: { RELEASED: { target: 'done', context: { clean: true } } }
		},
		failedRelease: {
			entry: (_, enq) => {
				enq.sendTo('lock', { type: 'RELEASE' })
			},
			on: { RELEASED: { target: 'done' } }
		},
		done: { type: 'final', entry: () => ({ context: { input: undefined, selection: undefined } }) }
	}
})
