import { assign, fromPromise, setup } from 'xstate'

type StartupEvent =
	{ type: 'START' } | { type: 'RETRY' } | { type: 'SESSION_FAILED' } | { type: 'SESSION_READY' }

export function createSessionStartupMachine<Result>(
	start: () => Promise<Result>,
	existing?: Result
) {
	const open = fromPromise(start)
	const startup = setup<{ result: Result | undefined }, StartupEvent, { open: typeof open }>({
		actors: { open }
	})

	return startup.createMachine({
		id: 'session-startup',
		initial: existing === undefined ? 'waiting' : 'ready',
		context: { result: existing },
		// SDK observations also cover failures initiated outside this UI actor.
		on: {
			SESSION_FAILED: { target: '.error' },
			SESSION_READY: { target: '.ready' }
		},
		states: {
			waiting: { on: { START: 'starting' } },
			starting: {
				invoke: {
					src: 'open',
					onDone: {
						target: 'ready',
						actions: assign(({ event }) => ({ result: event.output }))
					},
					onError: 'error'
				}
			},
			ready: {},
			error: { on: { RETRY: 'starting' } }
		}
	})
}
