import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { ensurePersonalWorkspace } from '#lib/data.js'
import { createWorkspaceBootstrapMachine } from './workspace-bootstrap.js'

vi.mock('#lib/data.js', () => ({ ensurePersonalWorkspace: vi.fn() }))

const ensure = vi.mocked(ensurePersonalWorkspace)
const organization = {
	id: '22222222-2222-4222-8222-222222222222',
	name: 'Personal workspace',
	kind: 'personal',
	defaultCurrency: 'USD',
	ownerId: '11111111-1111-4111-8111-111111111111'
} satisfies Awaited<ReturnType<typeof ensurePersonalWorkspace>>
const userId = organization.ownerId
const otherUserId = '33333333-3333-4333-8333-333333333333'

function start() {
	const db = { all: vi.fn(), transaction: vi.fn() } satisfies Parameters<
		typeof ensurePersonalWorkspace
	>[0]
	return { db, actor: createActor(createWorkspaceBootstrapMachine(db)).start() }
}

beforeEach(() => {
	ensure.mockReset()
	ensure.mockResolvedValue(organization)
})

describe('workspace bootstrap', () => {
	it('waits for a session and assigns its user before invoking setup', async () => {
		const { actor, db } = start()
		try {
			expect(actor.getSnapshot().matches('waitingForSession')).toBe(true)
			expect(ensure).not.toHaveBeenCalled()
			actor.send({ type: 'SESSION_READY', userId })
			expect(actor.getSnapshot().context.userId).toBe(userId)
			await waitFor(actor, (state) => state.matches('ready'))
			expect(ensure).toHaveBeenCalledExactlyOnceWith(db, userId)
		} finally {
			actor.stop()
		}
	})

	it('does not report ready until workspace persistence completes', async () => {
		const pending = Promise.withResolvers<typeof organization>()
		ensure.mockReturnValueOnce(pending.promise)
		const { actor } = start()
		try {
			actor.send({ type: 'SESSION_READY', userId })
			expect(actor.getSnapshot().matches('ensuringWorkspace')).toBe(true)
			pending.resolve(organization)
			await waitFor(actor, (state) => state.matches('ready'))
		} finally {
			actor.stop()
		}
	})

	it('uses the new identity when a ready session changes', async () => {
		const { actor, db } = start()
		try {
			actor.send({ type: 'SESSION_READY', userId })
			await waitFor(actor, (state) => state.matches('ready'))
			actor.send({ type: 'SESSION_READY', userId: otherUserId })
			await waitFor(actor, (state) => state.matches('ready'))
			expect(actor.getSnapshot().context.userId).toBe(otherUserId)
			expect(ensure).toHaveBeenNthCalledWith(2, db, otherUserId)
		} finally {
			actor.stop()
		}
	})

	it('ignores old completion when the identity changes during setup', async () => {
		const old = Promise.withResolvers<typeof organization>()
		const current = Promise.withResolvers<typeof organization>()
		ensure.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
		const { actor, db } = start()
		try {
			actor.send({ type: 'SESSION_READY', userId })
			actor.send({ type: 'SESSION_READY', userId: otherUserId })
			old.resolve(organization)
			await old.promise
			await Promise.resolve()
			expect(actor.getSnapshot().matches('ensuringWorkspace')).toBe(true)
			expect(actor.getSnapshot().context.userId).toBe(otherUserId)
			expect(ensure).toHaveBeenNthCalledWith(2, db, otherUserId)
			current.resolve(organization)
			await waitFor(actor, (state) => state.matches('ready'))
		} finally {
			actor.stop()
		}
	})

	it('stays waiting after session loss even when the old setup completes', async () => {
		const pending = Promise.withResolvers<typeof organization>()
		ensure.mockReturnValueOnce(pending.promise)
		const { actor } = start()
		try {
			actor.send({ type: 'SESSION_READY', userId })
			actor.send({ type: 'SESSION_UNAVAILABLE' })
			pending.resolve(organization)
			await pending.promise
			await Promise.resolve()
			expect(actor.getSnapshot().matches('waitingForSession')).toBe(true)
			actor.send({ type: 'SESSION_READY', userId })
			await waitFor(actor, (state) => state.matches('ready'))
			expect(ensure).toHaveBeenCalledTimes(2)
			actor.send({ type: 'SESSION_UNAVAILABLE' })
			expect(actor.getSnapshot().matches('waitingForSession')).toBe(true)
		} finally {
			actor.stop()
		}
	})

	it('reports setup failure and retries with the current identity', async () => {
		ensure.mockRejectedValueOnce(new Error('Persistence failed'))
		const { actor, db } = start()
		try {
			actor.send({ type: 'SESSION_READY', userId })
			await waitFor(actor, (state) => state.matches('error'))
			actor.send({ type: 'SESSION_READY', userId: otherUserId })
			await waitFor(actor, (state) => state.matches('ready'))
			expect(ensure).toHaveBeenNthCalledWith(2, db, otherUserId)
		} finally {
			actor.stop()
		}
	})
})
