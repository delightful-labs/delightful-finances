import {
	createAsyncLogic,
	createCallbackLogic,
	setup,
	types,
	matchesState,
	type ActorRefFrom
} from 'xstate'
import type { RuntimeView } from '../../runtime/worker/application-protocol.js'

export type WindowRuntimeReport =
	{ type: 'VIEW'; view: RuntimeView } | { type: 'CLOSED' } | { type: 'FAILED' }
export type WindowRuntimeConnection = {
	start: () => void
	requestShutdown: () => void
	subscribe: (publish: (report: WindowRuntimeReport) => void) => () => void
	closeData: () => void
	drainNativeLocks: () => Promise<void>
	dispose: () => void
}
const actors = {
	listen: createCallbackLogic<never, WindowRuntimeConnection>(({ input, sendBack }) =>
		input.subscribe(sendBack)
	),
	start: createAsyncLogic({
		run: async ({ input }: { input: WindowRuntimeConnection }) => input.start()
	}),
	fence: createAsyncLogic({
		run: async ({ input }: { input: WindowRuntimeConnection }) => input.closeData()
	}),
	drain: createAsyncLogic({
		run: ({ input }: { input: WindowRuntimeConnection }) => input.drainNativeLocks()
	}),
	requestShutdown: createAsyncLogic({
		run: async ({ input }: { input: WindowRuntimeConnection }) => input.requestShutdown()
	})
}
/** Window never interprets an error/deadline as an SDK release receipt. A
 * crashed or unresponsive worker stays retained; data admission is fenced and
 * late CLOSED can still finish its native cleanup. */
export const windowRuntimeMachine = setup({
	schemas: {
		input: types<WindowRuntimeConnection>(),
		context: types<{ connection: WindowRuntimeConnection; view: RuntimeView | undefined }>(),
		events: {
			VIEW: types<{ view: RuntimeView }>(),
			CLOSED: types(),
			FAILED: types(),
			CLOSE: types()
		},
		children: {
			listen: types<ActorRefFrom<typeof actors.listen>>(),
			start: types<ActorRefFrom<typeof actors.start>>(),
			fence: types<ActorRefFrom<typeof actors.fence>>(),
			drain: types<ActorRefFrom<typeof actors.drain>>(),
			requestShutdown: types<ActorRefFrom<typeof actors.requestShutdown>>()
		}
	},
	actors,
	states: {
		starting: {
			type: 'parallel',
			states: { control: { states: { open: {}, closing: {} } }, work: { states: { booting: {} } } }
		},
		running: { id: 'finance-window-runtime-running' },
		draining: { id: 'finance-window-runtime-draining' },
		fencing: {},
		drainingLocks: {},
		releaseBlocked: { id: 'finance-window-runtime-release-blocked' },
		closed: { type: 'final' }
	}
}).createMachine({
	id: 'finance-window-runtime',
	initial: 'starting',
	context: ({ input }) => ({ connection: input, view: undefined }),
	invoke: {
		id: 'listen',
		src: 'listen',
		input: ({ context }) => context.connection,
		onError: { target: '.releaseBlocked' }
	},
	on: {
		VIEW: ({ event }) => ({ context: { view: event.view } }),
		CLOSED: { target: '.fencing' },
		FAILED: { target: '.releaseBlocked' },
		CLOSE: {}
	},
	onError: { target: '.releaseBlocked' },
	states: {
		starting: {
			type: 'parallel',
			states: {
				control: {
					initial: 'open',
					states: { open: { on: { CLOSE: { target: 'closing' } } }, closing: {} }
				},
				work: {
					initial: 'booting',
					states: {
						booting: {
							invoke: {
								id: 'start',
								src: 'start',
								input: ({ context }) => context.connection,
								onDone: ({ value }) =>
									matchesState({ starting: { control: 'closing' } }, value)
										? { target: '#finance-window-runtime-draining' }
										: { target: '#finance-window-runtime-running' },
								onError: { target: '#finance-window-runtime-release-blocked' }
							}
						}
					}
				}
			}
		},
		running: { id: 'finance-window-runtime-running', on: { CLOSE: { target: 'draining' } } },
		draining: {
			id: 'finance-window-runtime-draining',
			invoke: {
				id: 'requestShutdown',
				src: 'requestShutdown',
				input: ({ context }) => context.connection,
				onError: { target: 'releaseBlocked' }
			}
		},
		fencing: {
			on: { CLOSED: {}, FAILED: {} },
			invoke: {
				id: 'fence',
				src: 'fence',
				input: ({ context }) => context.connection,
				onDone: { target: 'drainingLocks' },
				onError: { target: 'releaseBlocked' }
			}
		},
		drainingLocks: {
			on: { CLOSED: {}, FAILED: {} },
			invoke: {
				id: 'drain',
				src: 'drain',
				input: ({ context }) => context.connection,
				onDone: { target: 'closed' },
				onError: { target: 'releaseBlocked' }
			}
		},
		releaseBlocked: {
			id: 'finance-window-runtime-release-blocked',
			on: { FAILED: {} },
			onError: {},
			entry: ({ context }, enq) => {
				enq(() => context.connection.closeData())
			},
			invoke: {
				id: 'requestShutdown',
				src: 'requestShutdown',
				input: ({ context }) => context.connection,
				onError: {}
			}
		},
		closed: {
			type: 'final',
			entry: ({ context }, enq) => {
				enq(() => context.connection.dispose())
			}
		}
	}
})
