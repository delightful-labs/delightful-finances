import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, setup, sendParent, waitFor, type ActorRefFrom } from 'xstate'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import { generateAuthSecret } from 'jazz-tools'
import type { JazzClient, JazzSession, getDb } from 'jazz-tools/svelte'
import {
	createApplicationReadinessMachine,
	selectAttachedWorkspace,
	selectRecoveryView
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
type MutationErrorDb = Pick<ReturnType<typeof getDb>, 'onMutationError'>
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

function session(db?: MutationErrorDb) {
	let notify = () => {}
	const unsubscribe = vi.fn()
	const getSnapshot = vi.fn<Session['getSnapshot']>(() => {
		const snapshot: ReturnType<Session['getSnapshot']> = { status: 'ready' }
		if (db) Object.defineProperty(snapshot, 'client', { value: { db } })
		return snapshot
	})
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
	it('correlates late transfer rejections and releases the Jazz observer on shutdown', () => {
		const release = vi.fn()
		const onMutationError = vi.fn<MutationErrorDb['onMutationError']>(() => release)
		const current = session({ onMutationError })
		const actor = start(async () => current.value, current.value)

		expect(onMutationError).toHaveBeenCalledOnce()
		actor.send({
			type: 'TRANSFER_WRITE_TRACKED',
			write: { transactionId: 'tracked-write', operation: 'link', transferId: 'transfer-id' }
		})
		actor.send({ type: 'MUTATION_REJECTED', transactionId: 'tracked-write' })
		expect(actor.getSnapshot().context.mutationNotice).toEqual({
			kind: 'transfer',
			transactionId: 'tracked-write',
			operation: 'link',
			transferId: 'transfer-id'
		})

		actor.send({ type: 'DISMISS_MUTATION_REJECTION' })
		actor.send({ type: 'MUTATION_REJECTED', transactionId: 'untracked-write' })
		expect(actor.getSnapshot().context.mutationNotice).toEqual({
			kind: 'generic',
			transactionId: 'untracked-write'
		})
		actor.send({ type: 'SHUTDOWN' })
		expect(release).toHaveBeenCalledOnce()
	})

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

// Branded SDK account handles are opaque; these tests observe only their public id.
function accountSnapshot(id: string): ReturnType<Session['getSnapshot']> {
	const snapshot: ReturnType<Session['getSnapshot']> = { status: 'ready' }
	Object.defineProperty(snapshot, 'account', { value: { id } })
	return snapshot
}
function mutationFixture() {
	const current = session()
	current.getSnapshot.mockReturnValue(accountSnapshot('restored'))
	const pending = Promise.withResolvers<void>()
	const restore = vi.spyOn(current.value, 'restoreLocalFirst').mockReturnValue(pending.promise)
	const retry = vi.spyOn(current.value, 'retry').mockReturnValue(pending.promise)
	const navigate = vi.fn<(destination: string) => Promise<void>>(async () => {})
	const readHref = vi.fn(() => '/login')
	const open = vi.fn(async () => current.value)
	const actor = createActor(
		createApplicationReadinessMachine(open, current.value, { readHref, navigate })
	).start()
	actors.push(actor)
	const workspace = attach(actor)
	const attachment = actor.getSnapshot().context.attachment
	if (!attachment) throw new Error('Expected attachment')
	const phrase = RecoveryPhrase.fromSecret(generateAuthSecret())
	const command = {
		type: 'RECOVER',
		phrase,
		origin: '/login',
		destination: '/?workspace=original'
	} satisfies Parameters<typeof actor.send>[0]
	return {
		actor,
		current,
		pending,
		restore,
		retry,
		navigate,
		readHref,
		open,
		workspace,
		attachment,
		phrase,
		command
	}
}
async function beginRestore(f: ReturnType<typeof mutationFixture>) {
	f.actor.send(f.command)
	await waitFor(f.actor, (s) => s.matches({ running: { recovering: 'draining' } }))
	expect(f.restore).not.toHaveBeenCalled()
	control(f.workspace).close()
	await vi.waitFor(() => expect(f.restore).toHaveBeenCalledOnce())
}
function beginRetry(f: ReturnType<typeof mutationFixture>) {
	f.actor.send({ type: 'RETRY' })
	expect(f.retry).not.toHaveBeenCalled()
	expect(f.workspace.getSnapshot().matches('closing')).toBe(true)
	control(f.workspace).close()
	expect(f.retry).toHaveBeenCalledOnce()
}

describe('session mutation pre-drain and issued retry ownership', () => {
	it.each(['ready', 'signed-out', 'error', 'closed', 'transitioning'] satisfies ReturnType<
		Session['getSnapshot']
	>['status'][])('keeps retry through %s observations and duplicate commands', async (status) => {
		const f = mutationFixture()
		beginRetry(f)
		f.current.getSnapshot.mockReturnValue({ status })
		f.current.notify()
		f.actor.send({ type: 'RETRY' })
		f.actor.send({ type: 'START' })
		f.actor.send(f.command)
		expect(f.actor.getSnapshot().matches({ running: { retrying: 'active' } })).toBe(true)
		expect(f.actor.getSnapshot().context.status).toBe(status)
		expect(f.retry).toHaveBeenCalledOnce()
		expect(f.current.unsubscribe).not.toHaveBeenCalled()
		f.pending.resolve()
		await waitFor(f.actor, (s) => !s.matches({ running: 'retrying' }))
		expect(f.actor.getSnapshot().context.status).toBe(status)
		expect(f.actor.getSnapshot().context.attachmentRevision).toBe(1)
		expect(f.restore).not.toHaveBeenCalled()
		expect(f.current.value.close).not.toHaveBeenCalled()
	})
	it('rejects pending replacement work and stale closure before issuing retry', async () => {
		const f = mutationFixture()
		f.actor.send({ type: 'RETRY' })
		f.actor.send({ type: 'WORKSPACE_CLOSED', actor: {} })
		f.actor.send({ type: 'ATTACH_WORKSPACE', attachment: { ...f.attachment } })
		f.actor.send({ type: 'RETRY' })
		expect(f.retry).not.toHaveBeenCalled()
		expect(f.actor.getSnapshot().context.workspace).toBe(f.workspace)
		control(f.workspace).close()
		expect(f.retry).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().context.workspace).toBeUndefined()
		f.pending.resolve()
		await waitFor(f.actor, (s) => s.matches({ running: 'ready' }))
		expect(f.actor.getSnapshot().context.pending).toBeUndefined()
	})
	it.each(['shutdown', 'observer', 'crash'])(
		'starts no retry after %s during pre-drain',
		(interruption) => {
			const f = mutationFixture()
			f.actor.send({ type: 'RETRY' })
			if (interruption === 'shutdown') f.actor.send({ type: 'SHUTDOWN' })
			else if (interruption === 'observer') f.actor.send({ type: 'SESSION_OBSERVER_FAILED' })
			else control(f.workspace).crash()
			if (interruption !== 'crash') control(f.workspace).close()
			expect(f.retry).not.toHaveBeenCalled()
			expect(f.actor.getSnapshot().status).toBe(interruption === 'shutdown' ? 'done' : 'active')
		}
	)
	it('reports rejection without an SDK error observation and permits a fresh retry', async () => {
		const f = mutationFixture()
		beginRetry(f)
		f.pending.reject(new Error('private retry failure'))
		await waitFor(f.actor, (s) => s.matches({ running: 'failed' }))
		f.retry.mockResolvedValueOnce()
		f.actor.send({ type: 'RETRY' })
		await waitFor(f.actor, (s) => s.matches({ running: 'ready' }))
		expect(f.retry).toHaveBeenCalledTimes(2)
		expect(f.actor.getSnapshot().context.attachmentRevision).toBe(2)
	})
	it.each([
		{ interruption: 'shutdown', reject: false },
		{ interruption: 'shutdown', reject: true },
		{ interruption: 'observer', reject: false },
		{ interruption: 'observer', reject: true },
		{ interruption: 'startup', reject: false }
	])(
		'retains issued retry on $interruption (reject: $reject)',
		async ({ interruption, reject }) => {
			const f = mutationFixture()
			beginRetry(f)
			if (interruption === 'shutdown') f.actor.send({ type: 'SHUTDOWN' })
			else if (interruption === 'observer') {
				f.current.getSnapshot.mockImplementationOnce(() => {
					throw new Error('private')
				})
				f.current.notify()
			} else
				f.actor.send({
					type: 'xstate.error.actor.startup',
					actorId: 'startup',
					error: new Error('private')
				})
			f.actor.send({ type: 'RETRY' })
			f.actor.send({ type: 'ATTACH_WORKSPACE', attachment: { ...f.attachment } })
			f.actor.send({ type: 'SESSION_OBSERVED', status: 'ready' })
			expect(f.actor.getSnapshot().status).toBe('active')
			expect(f.current.unsubscribe).toHaveBeenCalledOnce()
			expect(f.actor.getSnapshot().context.pending).toBeUndefined()
			if (reject) f.pending.reject(new Error('private'))
			else f.pending.resolve()
			await waitFor(f.actor, (s) => !s.matches({ running: 'retrying' }))
			if (interruption === 'shutdown') expect(f.actor.getSnapshot().status).toBe('done')
			else
				expect(
					f.actor
						.getSnapshot()
						.matches(interruption === 'startup' ? 'startupActorFailed' : 'observerFailed')
				).toBe(true)
			expect(f.retry).toHaveBeenCalledOnce()
		}
	)
})

describe('application-owned account recovery', () => {
	it('preserves invalid drafts without workspace cleanup or an SDK call', async () => {
		const f = mutationFixture()
		f.actor.send({ ...f.command, phrase: 'invalid' })
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'invalid')
		expect(selectRecoveryView(f.actor.getSnapshot())).toMatchObject({
			invalid: true,
			busy: false,
			draftRevision: 0
		})
		expect(f.workspace.getSnapshot().matches('active')).toBe(true)
		expect(f.actor.getSnapshot().context.attachmentRevision).toBe(0)
		expect(f.restore).not.toHaveBeenCalled()
		expect(f.actor.getSnapshot().context.recoveryRequest).toBeUndefined()
	})
	it('waits for matching workspace cleanup, clears the secret and ignores duplicate commands', async () => {
		const f = mutationFixture()
		f.actor.send(f.command)
		await waitFor(f.actor, (s) => s.matches({ running: { recovering: 'draining' } }))
		const attempt = f.actor.getSnapshot().context.recoveryAttempt
		f.actor.send({ type: 'RECOVERY_DRAIN_REQUESTED', attempt: attempt - 1 })
		f.actor.send({ type: 'RECOVERY_VALIDATED', attempt: attempt - 1 })
		f.actor.send({ type: 'WORKSPACE_CLOSED', actor: {} })
		f.actor.send(f.command)
		f.actor.send({ type: 'RETRY' })
		expect(f.actor.getSnapshot().context.recoveryAttempt).toBe(attempt)
		expect(f.actor.getSnapshot().context.recoveryDraftRevision).toBe(1)
		expect(f.actor.getSnapshot().context.recoveryRequest).toBeUndefined()
		expect(f.restore).not.toHaveBeenCalled()
		control(f.workspace).close()
		await vi.waitFor(() => expect(f.restore).toHaveBeenCalledOnce())
		expect(f.restore).toHaveBeenCalledWith(RecoveryPhrase.toSecret(f.phrase))
		const child = f.actor.getSnapshot().children.recovery
		expect(child?.getSnapshot()).toMatchObject({
			context: { request: undefined, secret: undefined }
		})
		f.actor.send({ type: 'DETACH_WORKSPACE', attachment: f.attachment })
		f.pending.resolve()
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'restored')
		expect(f.navigate).toHaveBeenCalledExactlyOnceWith('/?workspace=original')
		expect(f.actor.getSnapshot().context.attachmentRevision).toBe(1)
		expect(JSON.stringify(f.actor.getSnapshot().context)).not.toContain(f.phrase)
	})
	it.each(['shutdown', 'observer', 'crash'])(
		'starts no restore after %s during drain',
		async (interruption) => {
			const f = mutationFixture()
			f.actor.send(f.command)
			await waitFor(f.actor, (s) => s.matches({ running: { recovering: 'draining' } }))
			if (interruption === 'shutdown') f.actor.send({ type: 'SHUTDOWN' })
			else if (interruption === 'observer') f.actor.send({ type: 'SESSION_OBSERVER_FAILED' })
			else control(f.workspace).crash()
			if (interruption !== 'crash') control(f.workspace).close()
			await waitFor(f.actor, (s) => !s.matches({ running: 'recovering' }))
			expect(f.restore).not.toHaveBeenCalled()
			expect(f.navigate).not.toHaveBeenCalled()
			expect(f.actor.getSnapshot().status).toBe(interruption === 'shutdown' ? 'done' : 'active')
		}
	)
	it.each([
		{ interruption: 'shutdown', reject: false },
		{ interruption: 'shutdown', reject: true },
		{ interruption: 'observer', reject: false },
		{ interruption: 'observer', reject: true },
		{ interruption: 'startup', reject: false }
	])(
		'retains issued restore on $interruption (reject: $reject)',
		async ({ interruption, reject }) => {
			const f = mutationFixture()
			await beginRestore(f)
			if (interruption === 'shutdown') f.actor.send({ type: 'SHUTDOWN' })
			else if (interruption === 'observer') f.actor.send({ type: 'SESSION_OBSERVER_FAILED' })
			else
				f.actor.send({
					type: 'xstate.error.actor.startup',
					actorId: 'startup',
					error: new Error('private')
				})
			f.actor.send({ type: 'SESSION_OBSERVED', status: 'ready' })
			f.actor.send({ type: 'RETRY' })
			f.actor.send({ type: 'ATTACH_WORKSPACE', attachment: { ...f.attachment } })
			expect(f.actor.getSnapshot().status).toBe('active')
			expect(f.actor.getSnapshot().context.pending).toBeUndefined()
			if (reject) f.pending.reject(new Error('private'))
			else f.pending.resolve()
			await waitFor(f.actor, (s) => !s.matches({ running: 'recovering' }))
			expect(f.navigate).not.toHaveBeenCalled()
			expect(f.restore).toHaveBeenCalledOnce()
			expect(f.actor.getSnapshot().status).toBe(interruption === 'shutdown' ? 'done' : 'active')
			expect(f.actor.getSnapshot().context.recoveryRequest).toBeUndefined()
		}
	)
	it('keeps shutdown priority over late actor failures and restore rejection', async () => {
		const f = mutationFixture()
		await beginRestore(f)
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
		f.pending.reject(new Error('late'))
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('remounts after same-client restore failure and rejects obsolete attachments', async () => {
		const f = mutationFixture()
		await beginRestore(f)
		const pendingAttachment = { ...f.attachment }
		f.actor.send({ type: 'ATTACH_WORKSPACE', attachment: pendingAttachment })
		expect(f.actor.getSnapshot().context.workspace).toBeUndefined()
		f.pending.reject(new Error('private restore failure'))
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'restoreFailed')
		expect(f.actor.getSnapshot().context.attachmentRevision).toBe(1)
		expect(f.actor.getSnapshot().context.pending).toBeUndefined()
		const replacement = attach(f.actor)
		f.actor.send({ type: 'DETACH_WORKSPACE', attachment: f.attachment })
		f.actor.send({ type: 'WORKSPACE_CLOSED', actor: f.workspace })
		expect(f.actor.getSnapshot().context.workspace).toBe(replacement)
		expect(selectRecoveryView(f.actor.getSnapshot()).failed).toBe(true)
	})
	it('retries navigation without another restore or remount', async () => {
		const f = mutationFixture()
		f.navigate.mockRejectedValueOnce(new Error('private navigation failure'))
		await beginRestore(f)
		f.pending.resolve()
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'navigationFailed')
		expect(selectRecoveryView(f.actor.getSnapshot())).toMatchObject({
			navigationFailed: true,
			canRetryNavigation: true
		})
		f.actor.send({ type: 'RETRY_NAVIGATION' })
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'restored')
		expect(f.restore).toHaveBeenCalledOnce()
		expect(f.navigate).toHaveBeenCalledTimes(2)
		expect(f.actor.getSnapshot().context.attachmentRevision).toBe(1)
	})
	it('does not redirect after the user navigates away during restoration', async () => {
		const f = mutationFixture()
		await beginRestore(f)
		f.readHref.mockReturnValue('/accounts')
		f.pending.resolve()
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'restored')
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('rechecks identity before retrying navigation', async () => {
		const f = mutationFixture()
		f.navigate.mockRejectedValueOnce(new Error('private'))
		await beginRestore(f)
		f.pending.resolve()
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'navigationFailed')
		f.current.getSnapshot.mockReturnValue(accountSnapshot('other'))
		f.actor.send({ type: 'RETRY_NAVIGATION' })
		await waitFor(f.actor, (s) => s.context.recoveryResult?.outcome === 'restored')
		expect(f.navigate).toHaveBeenCalledOnce()
		expect(f.restore).toHaveBeenCalledOnce()
	})
	it.each([false, true])('awaits issued navigation on shutdown (reject: %s)', async (reject) => {
		const f = mutationFixture()
		const navigation = Promise.withResolvers<void>()
		f.navigate.mockReturnValue(navigation.promise)
		await beginRestore(f)
		f.pending.resolve()
		await vi.waitFor(() => expect(f.navigate).toHaveBeenCalledOnce())
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.actor.getSnapshot().status).toBe('active')
		if (reject) navigation.reject(new Error('private'))
		else navigation.resolve()
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.restore).toHaveBeenCalledOnce()
	})
})
