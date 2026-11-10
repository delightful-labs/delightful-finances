import {
	createAsyncLogic,
	createCallbackLogic,
	setup,
	types,
	waitFor,
	type ActorRefFrom,
	type EventFromLogic,
	type InputFrom
} from 'xstate'
import {
	createSessionAcquisitionMachine,
	selectAcquiredSession
} from 'delightful-local-first/session/workflow'
import type { SessionOwnerInput } from 'delightful-local-first/session/workflow'
import type { AccountStore } from 'jazz-tools'
import type { JazzClient, JazzSession } from 'jazz-tools/client'
import { accountStoreOwnerMachine } from './account-store-owner.js'
import { createWorkerAccountStore } from '../../runtime/worker/account-store-facade.js'
import type { createApplicationReadinessMachine } from './application-readiness.js'

type Session = JazzSession<JazzClient>
type ApplicationLogic = ReturnType<typeof createApplicationReadinessMachine>
type Application = ActorRefFrom<ApplicationLogic>
const acquisitionLogic = createSessionAcquisitionMachine<Session>()
type Acquisition = ActorRefFrom<typeof acquisitionLogic>
type Accounts = ActorRefFrom<typeof accountStoreOwnerMachine>

/** All capabilities are worker-local. Neither these inputs nor actor snapshots
 * are a transport protocol; only the worker entry's decoded intents reach COMMAND. */
export type FinanceWorkerRuntimeInput = {
	accounts: InputFrom<typeof accountStoreOwnerMachine>
	acquire: (store: AccountStore) => SessionOwnerInput<Session>
	application: (currentSession: () => Session | undefined) => ApplicationLogic
	observeApplication?: (application: Application) => () => void
	closeHost: () => Promise<void>
	dispose: () => void
}
type Context = {
	dependencies: FinanceWorkerRuntimeInput
	accounts: Accounts | undefined
	acquisition: Acquisition | undefined
	application: Application | undefined
	session: Session | undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Finance worker resource unavailable')
	return value
}

const actors = {
	observe: createCallbackLogic<
		never,
		{ application: Application; observe: FinanceWorkerRuntimeInput['observeApplication'] }
	>(({ input }) => input.observe?.(input.application)),
	accounts: accountStoreOwnerMachine,
	acquisition: acquisitionLogic,
	applicationDrain: createAsyncLogic({
		run: ({ input, signal }: { input: Application; signal: AbortSignal }) =>
			waitFor(
				input,
				(snapshot) => snapshot.status === 'done' || snapshot.matches('cleanupFailed'),
				{ signal }
			)
	}),
	acquisitionDrain: createAsyncLogic({
		run: ({ input, signal }: { input: Acquisition; signal: AbortSignal }) =>
			waitFor(input, (snapshot) => !snapshot.matches('opening'), { signal })
	}),
	closeSession: createAsyncLogic({
		run: ({ input }: { input: Session }) => input.close()
	}),
	accountDrain: createAsyncLogic({
		run: ({ input, signal }: { input: Accounts; signal: AbortSignal }) =>
			waitFor(input, (snapshot) => snapshot.status === 'done', { signal })
	}),
	closeHost: createAsyncLogic({
		run: ({ input }: { input: FinanceWorkerRuntimeInput['closeHost'] }) => input()
	})
}

/** Resource order is part of the chart, including late SDK acquisition:
 * application drain → acquisition settlement → SDK close → account-store drain
 * → native host close receipt → local-port disposal. No timeout authorizes a
 * forced stop. Spawned owners survive state changes until their real release. */
export const financeWorkerRuntimeMachine = setup({
	schemas: {
		input: types<FinanceWorkerRuntimeInput>(),
		context: types<Context>(),
		events: {
			COMMAND: types<{ command: EventFromLogic<ApplicationLogic> }>(),
			SHUTDOWN: types(),
			ACCOUNT_HOST_CLOSED: types<{ scope: string }>()
		},
		children: {
			observe: types<ActorRefFrom<typeof actors.observe>>(),
			accounts: types<Accounts>(),
			acquisition: types<Acquisition>(),
			application: types<Application>(),
			applicationDrain: types<ActorRefFrom<typeof actors.applicationDrain>>(),
			acquisitionDrain: types<ActorRefFrom<typeof actors.acquisitionDrain>>(),
			closeSession: types<ActorRefFrom<typeof actors.closeSession>>(),
			accountDrain: types<ActorRefFrom<typeof actors.accountDrain>>(),
			closeHost: types<ActorRefFrom<typeof actors.closeHost>>()
		}
	},
	actors,
	states: {
		startingResources: {},
		startingApplication: {},
		running: {},
		drainingApplication: {},
		awaitingAcquisition: {},
		closingSession: {},
		drainingAccounts: {},
		closingHost: {},
		releaseBlocked: {},
		closed: { type: 'final' }
	}
}).createMachine({
	id: 'finance-worker-runtime',
	initial: 'startingResources',
	context: ({ input }) => ({
		dependencies: input,
		accounts: undefined,
		acquisition: undefined,
		application: undefined,
		session: undefined
	}),
	on: {
		ACCOUNT_HOST_CLOSED: ({ context, event }, enq) => {
			if (event.scope !== context.dependencies.accounts.storage.scope) return
			if (context.accounts?.getSnapshot().status === 'active')
				enq.sendTo(context.accounts, { type: 'HOST_CLOSED', scope: event.scope })
		},
		SHUTDOWN: {},
		COMMAND: {}
	},
	onError: { target: '.releaseBlocked' },
	states: {
		startingResources: {
			entry: ({ context }, enq) => {
				const accounts = enq.spawn('accounts', {
					id: 'accounts',
					input: context.dependencies.accounts
				})
				const acquisition = enq.spawn('acquisition', {
					id: 'acquisition',
					input: context.dependencies.acquire(createWorkerAccountStore(accounts))
				})
				return { context: { accounts, acquisition } }
			},
			always: { target: 'startingApplication' }
		},
		startingApplication: {
			entry: ({ context }, enq) => {
				const acquisition = required(context.acquisition)
				const application = enq.spawn(
					context.dependencies.application(() => selectAcquiredSession(acquisition.getSnapshot())),
					{ id: 'application' }
				)
				enq.sendTo(application, {
					type: 'START',
					startup: {
						owner: acquisition,
						scope: {
							binding: acquisition.getSnapshot().context.binding,
							attachment: {},
							generation: 0
						}
					}
				})
				return { context: { application } }
			},
			always: { target: 'running' }
		},
		running: {
			invoke: {
				id: 'observe',
				src: 'observe',
				input: ({ context }) => ({
					application: required(context.application),
					observe: context.dependencies.observeApplication
				}),
				onError: { target: 'drainingApplication' }
			},
			on: {
				'xstate.done.actor': ({ event }) =>
					event.actorId === 'application' || event.actorId === 'accounts'
						? { target: 'drainingApplication' }
						: undefined,
				COMMAND: ({ context, event }, enq) => {
					enq.sendTo(required(context.application), event.command)
				},
				SHUTDOWN: { target: 'drainingApplication' }
			},
			onError: { target: 'drainingApplication' }
		},
		drainingApplication: {
			entry: ({ context }, enq) => {
				if (context.application?.getSnapshot().status === 'active')
					enq.sendTo(context.application, { type: 'SHUTDOWN' })
			},
			invoke: {
				id: 'applicationDrain',
				src: 'applicationDrain',
				input: ({ context }) => required(context.application),
				onDone: ({ event }) =>
					event.output.status === 'done'
						? { target: 'awaitingAcquisition' }
						: { target: 'releaseBlocked' },
				onError: { target: 'releaseBlocked' }
			}
		},
		awaitingAcquisition: {
			invoke: {
				id: 'acquisitionDrain',
				src: 'acquisitionDrain',
				input: ({ context }) => required(context.acquisition),
				onDone: ({ event }) => {
					const session = selectAcquiredSession(event.output)
					return session
						? { target: 'closingSession', context: { session } }
						: { target: 'drainingAccounts' }
				},
				onError: { target: 'releaseBlocked' }
			}
		},
		closingSession: {
			invoke: {
				id: 'closeSession',
				src: 'closeSession',
				input: ({ context }) => required(context.session),
				onDone: { target: 'drainingAccounts', context: { session: undefined } },
				onError: { target: 'releaseBlocked' }
			}
		},
		drainingAccounts: {
			entry: ({ context }, enq) => {
				enq.sendTo(required(context.accounts), { type: 'SHUTDOWN' })
			},
			invoke: {
				id: 'accountDrain',
				src: 'accountDrain',
				input: ({ context }) => required(context.accounts),
				onDone: { target: 'closingHost' },
				onError: { target: 'releaseBlocked' }
			}
		},
		closingHost: {
			invoke: {
				id: 'closeHost',
				src: 'closeHost',
				input: ({ context }) => context.dependencies.closeHost,
				onDone: { target: 'closed' },
				onError: { target: 'releaseBlocked' }
			}
		},
		releaseBlocked: {},
		closed: {
			type: 'final',
			entry: ({ context }, enq) => {
				enq(() => context.dependencies.dispose())
				return {
					context: {
						application: undefined,
						acquisition: undefined,
						accounts: undefined,
						session: undefined
					}
				}
			}
		}
	}
})
