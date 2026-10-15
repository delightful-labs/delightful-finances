import { fromPromise, setup } from 'xstate'
import { ensurePersonalWorkspace } from '#lib/data.js'

export function createWorkspaceBootstrapMachine(db: Parameters<typeof ensurePersonalWorkspace>[0]) {
	const ensureWorkspace = fromPromise<
		Awaited<ReturnType<typeof ensurePersonalWorkspace>>,
		{ db: typeof db; userId: string }
	>(({ input }) => ensurePersonalWorkspace(input.db, input.userId))

	return setup({
		actors: { ensureWorkspace },
		types: {
			context: {} as { db: typeof db; userId: string | null },
			events: {} as { type: 'SESSION_READY'; userId: string } | { type: 'SESSION_UNAVAILABLE' }
		},
		actions: {
			setUser: ({ event }) => {
				if (event.type === 'SESSION_READY') return { userId: event.userId }
				return {}
			}
		}
	}).createMachine({
		id: 'workspace-bootstrap',
		initial: 'waitingForSession',
		context: { db, userId: null },
		states: {
			waitingForSession: {
				on: { SESSION_READY: { target: 'ensuringWorkspace', actions: 'setUser' } }
			},
			ensuringWorkspace: {
				invoke: {
					src: 'ensureWorkspace',
					input: ({ context }) => {
						if (!context.userId) throw new Error('Workspace setup requires a ready account.')
						return { db: context.db, userId: context.userId }
					},
					onDone: 'ready',
					onError: 'error'
				},
				on: {
					SESSION_READY: { target: 'ensuringWorkspace', reenter: true, actions: 'setUser' },
					SESSION_UNAVAILABLE: 'waitingForSession'
				}
			},
			ready: {
				on: {
					SESSION_READY: { target: 'ensuringWorkspace', actions: 'setUser' },
					SESSION_UNAVAILABLE: 'waitingForSession'
				}
			},
			error: {
				on: {
					SESSION_READY: { target: 'ensuringWorkspace', actions: 'setUser' },
					SESSION_UNAVAILABLE: 'waitingForSession'
				}
			}
		}
	})
}
