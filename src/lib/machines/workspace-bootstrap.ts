import { fromPromise, setup } from 'xstate'
import { ensurePersonalWorkspace } from '#lib/data.js'

export function createWorkspaceBootstrapMachine(db: Parameters<typeof ensurePersonalWorkspace>[0]) {
	const ensureWorkspace = fromPromise<
		Awaited<ReturnType<typeof ensurePersonalWorkspace>>,
		{ db: typeof db; userId: string }
	>(({ input }) => ensurePersonalWorkspace(input.db, input.userId))

	const bootstrap = setup<
		{ db: typeof db; userId: string | null },
		{ type: 'SESSION_READY'; userId: string } | { type: 'SESSION_UNAVAILABLE' },
		{ ensureWorkspace: typeof ensureWorkspace }
	>({ actors: { ensureWorkspace } })
	const setUser = bootstrap.assign(({ event }) =>
		event.type === 'SESSION_READY' ? { userId: event.userId } : {}
	)
	return bootstrap.createMachine({
		id: 'workspace-bootstrap',
		initial: 'waitingForSession',
		context: { db, userId: null },
		states: {
			waitingForSession: {
				on: { SESSION_READY: { target: 'ensuringWorkspace', actions: setUser } }
			},
			ensuringWorkspace: {
				invoke: {
					src: 'ensureWorkspace',
					input: ({ context }) => {
						if (!context.userId) throw new Error('Workspace setup requires a ready account.')
						return { db: context.db, userId: context.userId }
					},
					onDone: 'ready',
					onError: {
						target: 'error',
						actions: ({ event }) => console.error('Workspace preparation failed:', event.error)
					}
				},
				on: {
					SESSION_READY: { target: 'ensuringWorkspace', reenter: true, actions: setUser },
					SESSION_UNAVAILABLE: 'waitingForSession'
				}
			},
			ready: {
				on: {
					SESSION_READY: { target: 'ensuringWorkspace', actions: setUser },
					SESSION_UNAVAILABLE: 'waitingForSession'
				}
			},
			error: {
				on: {
					SESSION_READY: { target: 'ensuringWorkspace', actions: setUser },
					SESSION_UNAVAILABLE: 'waitingForSession'
				}
			}
		}
	})
}
