import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, setup, sendParent, waitFor, type ActorRefFrom } from 'xstate'
import type { JazzClient, JazzSession } from 'jazz-tools/svelte'
import {
	createApplicationReadinessMachine,
	selectAttachedWorkspace
} from './application-readiness.js'
import type { WorkspaceAttachment } from './readiness.js'

const { workspaceStart } = vi.hoisted(() => ({ workspaceStart: vi.fn() }))

// Delay workspace acknowledgement so shutdown races can be exercised deterministically.
vi.mock('./readiness.js', () => ({
	createWorkspaceReadinessMachine: () =>
		setup<{ value: undefined }, { type: 'SHUTDOWN' }>({}).createMachine({
			context: { value: undefined },
			initial: 'active',
			entry: workspaceStart,
			states: {
				active: { on: { SHUTDOWN: 'closing' } },
				closing: { on: { SHUTDOWN: 'closed' } },
				closed: {
					type: 'final',
					entry: sendParent(({ self }) => ({ type: 'WORKSPACE_CLOSED', actor: self }))
				}
			}
		})
}))

type Session = JazzSession<JazzClient>
const actors: ActorRefFrom<ReturnType<typeof createApplicationReadinessMachine>>[] = []
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
})
function session() {
	let notify = () => {}
	const unsubscribe = vi.fn()
	const getSnapshot = vi.fn<Session['getSnapshot']>(() => ({ status: 'ready' }))
	const subscribe = vi.fn<Session['subscribe']>((listener) => {
		notify = listener
		return unsubscribe
	})
	const value: Session = {
		getSnapshot,
		subscribe,
		retry: vi.fn(async () => {}),
		close: vi.fn(async () => {}),
		createLocalFirst: vi.fn(async () => {}),
		restoreLocalFirst: vi.fn(async () => {}),
		becomeBackend: vi.fn(async () => {}),
		registerJWT: vi.fn(async () => {}),
		loginJWT: vi.fn(async () => {}),
		loginOrRegisterJWT: vi.fn(async () => {}),
		linkJWT: vi.fn(async () => {}),
		logout: vi.fn(async () => {})
	}
	return { value, getSnapshot, subscribe, unsubscribe, notify: () => notify() }
}
function start(open: () => Promise<Session>, existing?: Session) {
	const actor = createActor(createApplicationReadinessMachine(open, existing)).start()
	actors.push(actor)
	return actor
}
function attach(actor: ReturnType<typeof start>) {
	// The workspace factory above owns no database effects in this test.
	const source = {
		organizationId: null,
		userId: undefined,
		sessionReady: false,
		membership: undefined,
		connections: [],
		accounts: [],
		links: []
	}
	const attachment: WorkspaceAttachment = {
		environment: 'test',
		dependencies: {
			db: vi.fn<() => WorkspaceAttachment['dependencies']['db']>()(),
			read: () => source,
			passkeyName: () => 'Test'
		},
		read: () => ({
			source,
			sessionStatus: 'ready',
			membershipLoading: false,
			membershipError: undefined,
			organizations: [],
			organizationsLoading: false,
			organizationsError: undefined,
			route: { pathname: '/settings/workspace', search: '', hash: '' }
		}),
		navigate: vi.fn(async () => {})
	}
	actor.send({ type: 'ATTACH_WORKSPACE', attachment })
	const workspace = actor.getSnapshot().context.workspace
	if (!workspace) throw new Error('Expected workspace')
	return workspace
}

describe('application readiness supervision', () => {
	it('retries failed opening and reuses the resulting session', async () => {
		const current = session()
		const open = vi
			.fn<() => Promise<Session>>()
			.mockRejectedValueOnce(new Error('private'))
			.mockResolvedValue(current.value)
		const actor = start(open)
		actor.send({ type: 'START' })
		await waitFor(actor, (state) => state.hasTag('startup-error'))
		expect(actor.getSnapshot().context.session).toBeUndefined()
		actor.send({ type: 'RETRY' })
		await waitFor(actor, (state) => state.matches({ running: 'ready' }))
		expect(open).toHaveBeenCalledTimes(2)
		expect(current.subscribe).toHaveBeenCalledTimes(1)
	})

	it('restarts startup after an unexpected child error instead of retrying a failed actor', async () => {
		const current = session()
		const open = vi.fn(async () => current.value)
		const actor = start(open)
		actor.send({
			type: 'xstate.error.actor.startup',
			actorId: 'startup',
			error: new Error('private')
		})
		expect(actor.getSnapshot().matches('startupActorFailed')).toBe(true)
		actor.send({ type: 'RETRY' })
		await waitFor(actor, (state) => state.matches({ running: 'ready' }))
		expect(open).toHaveBeenCalledTimes(1)
		expect(current.subscribe).toHaveBeenCalledTimes(1)
	})

	it('keeps shutdown priority over an unexpected startup error', () => {
		const current = session()
		const actor = start(async () => current.value, current.value)
		const workspace = attach(actor)
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'xstate.error.actor.startup', actorId: 'startup', error: new Error('late') })
		expect(actor.getSnapshot().matches('closing')).toBe(true)
		workspace.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('done')
	})

	it('models observer acquisition failure and retries without reopening the session', () => {
		const current = session()
		current.subscribe.mockImplementationOnce(() => {
			throw new Error('private')
		})
		const open = vi.fn(async () => current.value)
		const actor = start(open, current.value)
		expect(actor.getSnapshot().matches('observerFailed')).toBe(true)
		expect(actor.getSnapshot().status).toBe('active')
		actor.send({ type: 'RETRY' })
		expect(actor.getSnapshot().matches({ running: 'ready' })).toBe(true)
		expect(open).not.toHaveBeenCalled()
		expect(current.subscribe).toHaveBeenCalledTimes(2)
	})

	it('bridges SDK callback failure, unsubscribes, and waits for workspace cleanup before retry', () => {
		const current = session()
		const actor = start(async () => current.value, current.value)
		const workspace = attach(actor)
		current.getSnapshot.mockImplementationOnce(() => {
			throw new Error('private')
		})
		expect(() => current.notify()).not.toThrow()
		expect(actor.getSnapshot().matches('settlingObserverFailure')).toBe(true)
		expect(current.unsubscribe).toHaveBeenCalledTimes(1)
		expect(workspace.getSnapshot().matches('closing')).toBe(true)
		actor.send({ type: 'RETRY' })
		expect(current.subscribe).toHaveBeenCalledTimes(1)
		workspace.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().matches('observerFailed')).toBe(true)
		expect(actor.getSnapshot().context.workspace).toBeUndefined()
		actor.send({ type: 'RETRY' })
		expect(actor.getSnapshot().matches({ running: 'ready' })).toBe(true)
		expect(current.subscribe).toHaveBeenCalledTimes(2)
	})

	it('keeps shutdown priority over observer failure and retry', () => {
		const current = session()
		const actor = start(async () => current.value, current.value)
		const workspace = attach(actor)
		actor.send({ type: 'SESSION_OBSERVER_FAILED' })
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'RETRY' })
		actor.send({ type: 'SESSION_OBSERVED', status: 'ready' })
		expect(actor.getSnapshot().status).toBe('done')
		expect(workspace.getSnapshot().status).toBe('done')
		expect(current.subscribe).toHaveBeenCalledTimes(1)
	})

	it('ignores startup completion while workspace shutdown is pending', async () => {
		const current = session()
		const pending = Promise.withResolvers<Session>()
		const actor = start(() => pending.promise)
		actor.send({ type: 'START' })
		const workspace = attach(actor)
		actor.send({ type: 'SHUTDOWN' })
		pending.resolve(current.value)
		await pending.promise
		await Promise.resolve()
		expect(actor.getSnapshot().matches('closing')).toBe(true)
		expect(current.subscribe).not.toHaveBeenCalled()
		workspace.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('done')
	})

	it('releases a workspace that fails before acquisition without awaiting its acknowledgement', () => {
		const current = session()
		const actor = start(async () => current.value, current.value)
		workspaceStart.mockImplementationOnce(() => {
			throw new Error('private')
		})
		// Attachment is valid; its child fails during startup.
		const source = {
			organizationId: null,
			userId: undefined,
			sessionReady: false,
			membership: undefined,
			connections: [],
			accounts: [],
			links: []
		}
		actor.send({
			type: 'ATTACH_WORKSPACE',
			attachment: {
				environment: 'test',
				dependencies: {
					db: vi.fn<() => WorkspaceAttachment['dependencies']['db']>()(),
					read: () => source,
					passkeyName: () => 'Test'
				},
				read: () => ({
					source,
					sessionStatus: 'ready',
					membershipLoading: false,
					membershipError: undefined,
					organizations: [],
					organizationsLoading: false,
					organizationsError: undefined,
					route: { pathname: '/settings/workspace', search: '', hash: '' }
				}),
				navigate: vi.fn(async () => {})
			}
		})
		expect(actor.getSnapshot().matches('observerFailed')).toBe(true)
		expect(actor.getSnapshot().context.workspace).toBeUndefined()
		expect(current.unsubscribe).toHaveBeenCalledTimes(1)
		actor.send({ type: 'RETRY' })
		expect(actor.getSnapshot().matches({ running: 'ready' })).toBe(true)
	})

	it('ignores detach/completion from a replaced workspace', () => {
		const current = session()
		const actor = start(async () => current.value, current.value)
		const previous = attach(actor)
		const previousAttachment = actor.getSnapshot().context.attachment
		if (!previousAttachment) throw new Error('Missing attachment')
		attach(actor)
		previous.send({ type: 'SHUTDOWN' })
		const replacement = actor.getSnapshot().context.workspace
		expect(replacement).not.toBe(previous)
		actor.send({ type: 'DETACH_WORKSPACE', attachment: previousAttachment })
		actor.send({ type: 'WORKSPACE_CLOSED', actor: previous })
		actor.send({
			type: `xstate.error.actor.${previous.id}`,
			actorId: previous.id,
			error: new Error('stale')
		})
		expect(actor.getSnapshot().context.workspace).toBe(replacement)
		expect(replacement?.getSnapshot().matches('active')).toBe(true)
	})
	it('cancels a pending attachment before it can spawn an orphan owner', () => {
		const current = session()
		const actor = start(async () => current.value, current.value)
		const previous = attach(actor)
		attach(actor)
		const pending = actor.getSnapshot().context.pending
		if (!pending) throw new Error('Missing pending attachment')
		expect(selectAttachedWorkspace(actor.getSnapshot(), pending)).toBeUndefined()
		actor.send({ type: 'DETACH_WORKSPACE', attachment: pending })
		previous.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().context.pending).toBeUndefined()
		expect(actor.getSnapshot().context.workspace).toBeUndefined()
		expect(actor.getSnapshot().context.attachment).toBeUndefined()
	})
	it('does not replace the owner when the same attachment is submitted twice', () => {
		const current = session()
		const actor = start(async () => current.value, current.value)
		const workspace = attach(actor)
		const attachment = actor.getSnapshot().context.attachment
		if (!attachment) throw new Error('Missing attachment')
		actor.send({ type: 'ATTACH_WORKSPACE', attachment })
		expect(selectAttachedWorkspace(actor.getSnapshot(), attachment)).toBe(workspace)
		expect(workspace.getSnapshot().matches('active')).toBe(true)
		expect(actor.getSnapshot().context.pending).toBeUndefined()
	})
})
