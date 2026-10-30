import { assign, fromPromise, setup } from 'xstate'

type StartupEvent = { type: 'START' } | { type: 'RETRY' }

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
