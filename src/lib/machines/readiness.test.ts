import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor, createMachine, waitFor } from 'xstate'
import {
	createWorkspaceReadinessMachine,
	type ReadinessObservation,
	type WorkspaceAttachment
} from './readiness.js'

const { bankStart, bankObservation, bootstrap } = vi.hoisted(() => ({
	bankStart: vi.fn(),
	bankObservation: vi.fn(),
	bootstrap: vi.fn(async () => {})
}))
vi.mock('#lib/data.js', () => ({ ensurePersonalWorkspace: bootstrap }))
vi.mock('./bank-sync/index.js', () => ({
	createBankSyncMachine: () =>
		createMachine({
			initial: 'working',
			entry: bankStart,
			on: { OBSERVED: { actions: bankObservation } },
			states: {
				working: { on: { SHUTDOWN: 'closing', RESET: 'closed' } },
				closing: { on: { SHUTDOWN: 'closed' } },
				closed: { type: 'final' }
			}
		})
}))
const cleanup: (() => void)[] = []
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose()
})
beforeEach(() => {
	vi.clearAllMocks()
	bankStart.mockImplementation(() => {})
	bankObservation.mockImplementation(() => {})
})
function start(selectOrganization = vi.fn<(id: string | null) => void>()) {
	const source = {
		userId: 'owner',
		organizationId: null,
		sessionReady: true,
		membership: undefined,
		connections: [],
		accounts: [],
		links: []
	}
	const observation: ReadinessObservation = {
		source,
		sessionStatus: 'ready',
		membershipLoading: false,
		membershipError: undefined,
		organizations: [],
		organizationsLoading: false,
		organizationsError: undefined
	}
	const attachment: WorkspaceAttachment = {
		dependencies: {
			db: vi.fn<() => WorkspaceAttachment['dependencies']['db']>()(),
			read: () => source,
			passkeyName: () => 'Test'
		},
		read: () => observation,
		selectOrganization
	}
	// Completion normally notifies the application parent; supply one here as well.
	const parent = createActor(
		createMachine({ invoke: { id: 'workspace', src: createWorkspaceReadinessMachine(attachment) } })
	).start()
	const child = parent.getSnapshot().children.workspace
	if (!child) throw new Error('Expected workspace')
	// Keep the actual invoked child to exercise sendParent on completion.
	cleanup.push(() => parent.stop())
	const bank = child.getSnapshot().children.bank
	if (!bank) throw new Error('Expected bank')
	return { actor: child, bank, observation, parent }
}

describe('workspace readiness supervision', () => {
	it('shows workspace failure when the bank child cannot start', () => {
		bankStart.mockImplementationOnce(() => {
			throw new Error('private')
		})
		const { actor, parent } = start()
		expect(actor.getSnapshot().hasTag('workspace-error')).toBe(true)
		expect(actor.getSnapshot().status).toBe('active')
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('done')
		parent.stop()
	})

	it('does not wait for shutdown acknowledgement from an already failed bank', () => {
		const { actor, observation, parent } = start()
		bankObservation.mockImplementationOnce(() => {
			throw new Error('private')
		})
		actor.send({ type: 'OBSERVED', observation })
		expect(actor.getSnapshot().matches('failed')).toBe(true)
		actor.send({ type: 'OBSERVED', observation })
		expect(bankObservation).toHaveBeenCalledTimes(1)
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('done')
		parent.stop()
	})

	it('treats unexpected bank completion as failure instead of silently closing the workspace', () => {
		const { actor, parent } = start()
		actor.send({ type: 'BANK', event: { type: 'RESET' } })
		expect(actor.getSnapshot().matches('failed')).toBe(true)
		expect(actor.getSnapshot().hasTag('workspace-ready')).toBe(false)
		parent.stop()
	})

	it('waits for live bank cleanup and ignores observations during shutdown', () => {
		const { actor, bank, observation, parent } = start()
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'OBSERVED', observation })
		actor.send({ type: 'BANK', event: { type: 'RESET' } })
		expect(actor.getSnapshot().matches('closing')).toBe(true)
		expect(bankObservation).not.toHaveBeenCalled()
		bank.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('done')
		parent.stop()
	})

	it('handles organization selection exceptions through actor failure and bank cleanup', async () => {
		const selection = vi.fn(() => {
			throw new Error('private')
		})
		const { actor, bank, parent } = start(selection)
		await waitFor(actor, (state) => state.matches('settlingFailure'))
		expect(selection).toHaveBeenCalledWith(null)
		expect(bank.getSnapshot().matches('closing')).toBe(true)
		bank.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().matches('failed')).toBe(true)
		expect(actor.getSnapshot().hasTag('workspace-error')).toBe(true)
		parent.stop()
	})
})
