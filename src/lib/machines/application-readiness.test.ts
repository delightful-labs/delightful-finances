import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, setup, sendParent, waitFor, type ActorRefFrom } from 'xstate'
import type { JazzClient, JazzSession } from 'jazz-tools/svelte'
import {
	createApplicationReadinessMachine,
	selectAttachedWorkspace
} from './application-readiness.js'
import type { WorkspaceAttachment } from './readiness.js'

const { workspaceStart, workspaceControls } = vi.hoisted(() => ({
	workspaceStart: vi.fn(),
	workspaceControls: new Map<string, { close: () => void; crash: () => void }>()
}))

// Delay workspace acknowledgement so shutdown races can be exercised deterministically.
vi.mock('./readiness.js', () => ({
	createWorkspaceReadinessMachine: () =>
		setup<{ value: undefined }, { type: 'SHUTDOWN' } | { type: 'ACK_CLOSE' } | { type: 'CRASH' }>(
			{}
		).createMachine({
			context: { value: undefined },
			initial: 'active',
			entry: [
				workspaceStart,
				({ self }) => {
					workspaceControls.set(self.id, {
						close: () => self.send({ type: 'ACK_CLOSE' }),
						crash: () => self.send({ type: 'CRASH' })
					})
				}
			],
			on: {
				CRASH: {
					actions: () => {
						throw new Error('private workspace crash')
					}
				}
			},
			states: {
				active: { on: { SHUTDOWN: 'closing' } },
				closing: { on: { ACK_CLOSE: 'closed' } },
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
	workspaceControls.clear()
})
function control(actor: { id: string }) {
	const value = workspaceControls.get(actor.id)
	if (!value) throw new Error('Expected workspace test controls')
	return value
}

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
		control(workspace).close()
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
		control(workspace).close()
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
		expect(actor.getSnapshot().matches('closing')).toBe(true)
		control(workspace).close()
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
		control(workspace).close()
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
		control(previous).close()
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
		control(previous).close()
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

describe('issued session retry ownership', () => {
	function retrying() {
		const current = session()
		const pending = Promise.withResolvers<void>()
		const retry = vi.spyOn(current.value, 'retry').mockReturnValue(pending.promise)
		const open = vi.fn(async () => current.value)
		const actor = start(open, current.value)
		const workspace = attach(actor)
		actor.send({ type: 'RETRY' })
		expect(retry).toHaveBeenCalledOnce()
		return { current, pending, retry, open, actor, workspace }
	}

	it.each(['ready', 'signed-out', 'error', 'closed', 'transitioning'] satisfies ReturnType<
		Session['getSnapshot']
	>['status'][])(
		'keeps the issued retry through %s observations and ignores duplicate commands',
		async (status) => {
			const f = retrying()
			f.current.getSnapshot.mockReturnValue({ status })
			f.current.notify()
			f.actor.send({ type: 'RETRY' })
			f.actor.send({ type: 'START' })
			expect(f.actor.getSnapshot().matches({ running: { retrying: 'active' } })).toBe(true)
			expect(f.actor.getSnapshot().context.status).toBe(status)
			expect(f.retry).toHaveBeenCalledOnce()
			expect(f.current.subscribe).toHaveBeenCalledOnce()
			expect(f.current.unsubscribe).not.toHaveBeenCalled()
			f.pending.resolve()
			await waitFor(f.actor, (s) => !s.matches({ running: 'retrying' }))
			expect(f.actor.getSnapshot().context.status).toBe(status)
			expect(f.open).not.toHaveBeenCalled()
			expect(f.current.value.close).not.toHaveBeenCalled()
		}
	)

	it('reports a rejected retry even without an SDK error observation and permits a fresh retry', async () => {
		const f = retrying()
		f.current.notify()
		f.pending.reject(new Error('private retry failure'))
		await waitFor(f.actor, (s) => s.hasTag('startup-error'))
		expect(f.actor.getSnapshot().matches({ running: 'failed' })).toBe(true)
		expect(f.actor.getSnapshot().context.status).toBe('ready')
		expect(JSON.stringify(f.actor.getSnapshot().context)).not.toContain('private retry failure')
		f.retry.mockResolvedValueOnce()
		f.actor.send({ type: 'RETRY' })
		await waitFor(f.actor, (s) => s.matches({ running: 'ready' }))
		expect(f.retry).toHaveBeenCalledTimes(2)
	})

	it.each([
		{ interruption: 'shutdown', settleFirst: true, reject: false },
		{ interruption: 'shutdown', settleFirst: false, reject: false },
		{ interruption: 'shutdown', settleFirst: true, reject: true },
		{ interruption: 'shutdown', settleFirst: false, reject: true },
		{ interruption: 'observer', settleFirst: true, reject: false },
		{ interruption: 'observer', settleFirst: false, reject: false },
		{ interruption: 'observer', settleFirst: true, reject: true },
		{ interruption: 'observer', settleFirst: false, reject: true }
	])(
		'drains retry and workspace on $interruption (settle first: $settleFirst, reject: $reject)',
		async ({ interruption, settleFirst, reject }) => {
			const f = retrying()
			if (interruption === 'shutdown') f.actor.send({ type: 'SHUTDOWN' })
			else {
				f.current.getSnapshot.mockImplementationOnce(() => {
					throw new Error('private snapshot failure')
				})
				f.current.notify()
			}
			expect(f.current.unsubscribe).toHaveBeenCalledOnce()
			expect(f.workspace.getSnapshot().matches('closing')).toBe(true)
			const original = f.actor.getSnapshot().context.attachment
			if (!original) throw new Error('Expected original attachment')
			f.actor.send({ type: 'ATTACH_WORKSPACE', attachment: { ...original } })
			f.actor.send({ type: 'RETRY' })
			f.actor.send({ type: 'START' })
			f.actor.send({ type: 'SESSION_OBSERVED', status: 'ready' })
			expect(f.actor.getSnapshot().context.pending).toBeUndefined()
			expect(f.retry).toHaveBeenCalledOnce()
			if (!settleFirst) {
				control(f.workspace).close()
				expect(f.actor.getSnapshot().status).toBe('active')
				expect(f.actor.getSnapshot().context.workspace).toBeUndefined()
			}
			if (reject) f.pending.reject(new Error('private retry failure'))
			else f.pending.resolve()
			if (settleFirst) {
				await waitFor(f.actor, (s) => !s.matches({ running: 'retrying' }))
				expect(f.actor.getSnapshot().status).toBe('active')
				expect(f.actor.getSnapshot().context.workspace).toBe(f.workspace)
				control(f.workspace).close()
			}
			if (interruption === 'shutdown') {
				await waitFor(f.actor, (s) => s.status === 'done')
			} else {
				await waitFor(f.actor, (s) => s.matches('observerFailed'))
				f.actor.send({ type: 'RETRY' })
				expect(f.actor.getSnapshot().matches({ running: 'ready' })).toBe(true)
				expect(f.current.subscribe).toHaveBeenCalledTimes(2)
			}
			expect(f.open).not.toHaveBeenCalled()
			expect(f.current.value.close).not.toHaveBeenCalled()
		}
	)

	it.each(['startup', 'sessionObserver'])(
		'retains retry on unexpected %s actor failure',
		async (actorId) => {
			const f = retrying()
			f.actor.send({
				type: `xstate.error.actor.${actorId}`,
				actorId,
				error: new Error('private actor failure')
			})
			expect(f.actor.getSnapshot().matches({ running: 'retrying' })).toBe(true)
			expect(f.current.unsubscribe).toHaveBeenCalledOnce()
			control(f.workspace).close()
			expect(f.actor.getSnapshot().status).toBe('active')
			f.pending.resolve()
			await waitFor(f.actor, (s) =>
				s.matches(actorId === 'startup' ? 'startupActorFailed' : 'observerFailed')
			)
			f.actor.send({ type: 'RETRY' })
			await waitFor(f.actor, (s) => s.matches({ running: 'ready' }))
			expect(f.retry).toHaveBeenCalledOnce()
		}
	)

	it('releases a crashed workspace but retains the retry until settlement', async () => {
		const f = retrying()
		control(f.workspace).crash()
		expect(f.actor.getSnapshot().context.workspace).toBeUndefined()
		expect(f.actor.getSnapshot().matches({ running: { retrying: 'observerFailed' } })).toBe(true)
		f.pending.resolve()
		await waitFor(f.actor, (s) => s.matches('observerFailed'))
	})

	it('keeps shutdown priority through late actor errors, observations and workspace failure', async () => {
		const f = retrying()
		f.actor.send({ type: 'SESSION_OBSERVER_FAILED' })
		f.actor.send({
			type: 'xstate.error.actor.startup',
			actorId: 'startup',
			error: new Error('private')
		})
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({
			type: 'xstate.error.actor.startup',
			actorId: 'startup',
			error: new Error('late')
		})
		f.actor.send({
			type: 'xstate.error.actor.sessionObserver',
			actorId: 'sessionObserver',
			error: new Error('late')
		})
		f.actor.send({ type: 'SESSION_OBSERVER_FAILED' })
		f.actor.send({ type: 'SESSION_OBSERVED', status: 'ready' })
		f.actor.send({ type: 'RETRY' })
		control(f.workspace).crash()
		expect(f.actor.getSnapshot().matches({ running: { retrying: 'closing' } })).toBe(true)
		expect(f.actor.getSnapshot().context.workspace).toBeUndefined()
		f.pending.reject(new Error('late retry failure'))
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.retry).toHaveBeenCalledOnce()
		expect(f.current.subscribe).toHaveBeenCalledOnce()
	})
})
