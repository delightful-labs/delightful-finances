import { assign, fromCallback, fromPromise, setup, type SnapshotFrom } from 'xstate'

type UpdateWorker = { postMessage: (message: { type: 'ACTIVATE_UPDATE' }) => void }
type UpdateRegistration = EventTarget & {
	waiting: UpdateWorker | null
	installing: ServiceWorker | null
}

export type UpdateEvent =
	| { type: 'READY'; worker: UpdateWorker }
	| { type: 'ACTIVATED' | 'ACCEPT' | 'LATER' | 'RETRY' | 'SHUTDOWN' | 'OBSERVER_FAILED' }

export type PwaUpdateView = 'hidden' | 'ready' | 'reload' | 'busy' | 'failed'

export function createPwaUpdateMachine(platform: {
	registration: () => Promise<UpdateRegistration | undefined>
	observe: (registration: UpdateRegistration, send: (event: UpdateEvent) => void) => () => void
	controller: () => UpdateWorker | null
	reload: () => void
}) {
	const actors = {
		registration: fromPromise(() => platform.registration()),
		observe: fromCallback<UpdateEvent, UpdateRegistration>(({ input, sendBack }) =>
			platform.observe(input, sendBack)
		),
		activate: fromPromise<void, UpdateWorker>(async ({ input }) => {
			input.postMessage({ type: 'ACTIVATE_UPDATE' })
		}),
		reload: fromPromise(async () => platform.reload())
	}
	return setup<
		{
			registration: UpdateRegistration | undefined
			worker: UpdateWorker | null
			originalController: UpdateWorker | null
		},
		UpdateEvent,
		typeof actors
	>({ actors }).createMachine({
		id: 'pwa-update',
		context: () => ({
			registration: undefined,
			worker: null,
			originalController: platform.controller()
		}),
		initial: 'discovering',
		on: { SHUTDOWN: '.cancelled' },
		states: {
			discovering: {
				invoke: {
					src: 'registration',
					onDone: [
						{
							guard: ({ event }) => event.output !== undefined,
							target: 'watching',
							actions: assign({ registration: ({ event }) => event.output })
						},
						{ target: 'unsupported' }
					],
					onError: 'unavailable'
				}
			},
			watching: {
				invoke: {
					src: 'observe',
					input: ({ context }) => {
						if (!context.registration) throw new Error('Missing service worker registration')
						return context.registration
					},
					onError: '#pwa-update.unavailable'
				},
				initial: 'idle',
				on: {
					OBSERVER_FAILED: '#pwa-update.unavailable',
					READY: {
						guard: ({ context, event }) => context.worker !== event.worker,
						target: '.ready',
						actions: assign({ worker: ({ event }) => event.worker })
					},
					ACTIVATED: '.reloadReady'
				},
				states: {
					idle: {},
					ready: { on: { ACCEPT: 'checking', LATER: 'dismissed' } },
					dismissed: {},
					reloadReady: { on: { ACCEPT: 'reloading', LATER: 'dismissed' } },
					checking: {
						always: [
							{
								guard: ({ context }) => context.registration?.waiting != null,
								target: 'activating',
								actions: assign({ worker: ({ context }) => context.registration?.waiting ?? null })
							},
							{
								guard: ({ context }) => platform.controller() !== context.originalController,
								target: 'reloading'
							},
							{ target: 'failed' }
						]
					},
					activating: {
						initial: 'requesting',
						after: { 15000: 'failed' },
						on: { ACTIVATED: 'reloading', READY: {} },
						states: {
							requesting: {
								invoke: {
									src: 'activate',
									input: ({ context }) => {
										if (!context.worker) throw new Error('Missing waiting worker')
										return context.worker
									},
									onDone: 'waiting',
									onError: '#pwa-update.watching.failed'
								}
							},
							waiting: {}
						}
					},
					reloading: {
						on: { READY: {}, ACTIVATED: {} },
						invoke: { src: 'reload', onError: 'failed' },
						after: { 15000: 'failed' }
					},
					failed: { on: { RETRY: 'checking', LATER: 'dismissed' } }
				}
			},
			unavailable: { on: { RETRY: 'discovering', LATER: 'unsupported' } },
			unsupported: { type: 'final' },
			cancelled: { type: 'final' }
		}
	})
}

export function selectPwaUpdateView(
	snapshot: SnapshotFrom<ReturnType<typeof createPwaUpdateMachine>>
): PwaUpdateView {
	if (snapshot.matches({ watching: 'ready' })) return 'ready'
	if (snapshot.matches({ watching: 'reloadReady' })) return 'reload'
	if (snapshot.matches({ watching: 'activating' }) || snapshot.matches({ watching: 'reloading' }))
		return 'busy'
	if (snapshot.matches({ watching: 'failed' }) || snapshot.matches('unavailable')) return 'failed'
	return 'hidden'
}
