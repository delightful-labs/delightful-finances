import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor, createMachine, waitFor } from 'xstate'
import {
	createWorkspaceReadinessMachine,
	type ReadinessObservation,
	type WorkspaceAttachment
} from './readiness.js'

const { bankStart, bankObservation, startupObservation } = vi.hoisted(() => ({
	bankStart: vi.fn(),
	bankObservation: vi.fn(),
	startupObservation: vi.fn()
}))
vi.mock('./workspace-startup.js', () => ({
	createWorkspaceStartupMachine: () =>
		createMachine({
			initial: 'ready',
			on: { OBSERVED: { actions: startupObservation } },
			states: {
				ready: { tags: 'workspace-ready', on: { SHUTDOWN: 'closing', FAIL: 'failed' } },
				failed: { tags: 'workspace-error', on: { SHUTDOWN: 'closing', RETRY: 'ready' } },
				closing: { on: { FINISH: 'closed' } },
				closed: { type: 'final' }
			}
		})
}))
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
	const startup = child.getSnapshot().children.startup
	if (!startup) throw new Error('Expected startup owner')
	return { actor: child, bank, startup, observation, parent }
}

describe('workspace readiness supervision', () => {
	it('shows workspace failure when the bank child cannot start', () => {
		bankStart.mockImplementationOnce(() => {
			throw new Error('private')
		})
		const { actor, parent, startup } = start()
		startup.send({ type: 'FINISH' })
		expect(actor.getSnapshot().hasTag('workspace-error')).toBe(true)
		expect(actor.getSnapshot().status).toBe('active')
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('done')
		parent.stop()
	})

	it('does not wait for shutdown acknowledgement from an already failed bank', () => {
		const { actor, observation, parent, startup } = start()
		bankObservation.mockImplementationOnce(() => {
			throw new Error('private')
		})
		actor.send({ type: 'OBSERVED', observation })
		startup.send({ type: 'FINISH' })
		expect(actor.getSnapshot().matches('failed')).toBe(true)
		actor.send({ type: 'OBSERVED', observation })
		expect(bankObservation).toHaveBeenCalledTimes(1)
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('done')
		parent.stop()
	})

	it('treats unexpected bank completion as failure instead of silently closing the workspace', () => {
		const { actor, parent, startup } = start()
		actor.send({ type: 'BANK', event: { type: 'RESET' } })
		startup.send({ type: 'FINISH' })
		expect(actor.getSnapshot().matches('failed')).toBe(true)
		expect(actor.getSnapshot().hasTag('workspace-ready')).toBe(false)
		parent.stop()
	})

	it('waits for live bank cleanup and ignores observations during shutdown', () => {
		const { actor, bank, observation, parent, startup } = start()
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'OBSERVED', observation })
		actor.send({ type: 'BANK', event: { type: 'RESET' } })
		expect(actor.getSnapshot().matches('closing')).toBe(true)
		expect(bankObservation).not.toHaveBeenCalled()
		bank.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('active')
		startup.send({ type: 'FINISH' })
		expect(actor.getSnapshot().status).toBe('done')
		parent.stop()
	})

	it('handles organization selection exceptions through actor failure and bank cleanup', async () => {
		const selection = vi.fn(() => {
			throw new Error('private')
		})
		const { actor, bank, parent, startup } = start(selection)
		await waitFor(actor, (state) => state.matches('closing'))
		expect(selection).toHaveBeenCalledWith(null)
		expect(bank.getSnapshot().matches('closing')).toBe(true)
		bank.send({ type: 'SHUTDOWN' })
		startup.send({ type: 'FINISH' })
		expect(actor.getSnapshot().matches('failed')).toBe(true)
		expect(actor.getSnapshot().hasTag('workspace-error')).toBe(true)
		parent.stop()
	})
})

describe('workspace readiness selection and recovery', () => {
	const workspace = {
		id: 'business',
		name: 'Business',
		kind: 'business',
		defaultCurrency: 'USD',
		ownerId: 'owner'
	}
	it('exposes retryable startup failures without replacing the bank owner', async () => {
		const f = start()
		const bank = f.bank
		f.startup.send({ type: 'FAIL' })
		await waitFor(f.actor, (s) => s.hasTag('workspace-retryable'))
		f.actor.send({ type: 'RETRY' })
		await waitFor(f.actor, (s) => s.hasTag('workspace-ready'))
		expect(f.actor.getSnapshot().children.bank).toBe(bank)
	})
	it('does not prefer personal kind or pick arbitrarily among multiple workspaces', async () => {
		const select = vi.fn<(id: string | null) => void>()
		const f = start(select)
		f.actor.send({
			type: 'OBSERVED',
			observation: {
				...f.observation,
				organizations: [workspace, { ...workspace, id: 'personal', kind: 'personal' }]
			}
		})
		await waitFor(f.actor, (s) => s.matches({ active: { selection: 'unselected' } }))
		expect(select).not.toHaveBeenCalledWith('personal')
		expect(select).not.toHaveBeenCalledWith('business')
	})
	it('selects a sole business workspace when no workspace is selected', async () => {
		const select = vi.fn<(id: string | null) => void>()
		const f = start(select)
		f.actor.send({
			type: 'OBSERVED',
			observation: { ...f.observation, organizations: [workspace] }
		})
		await waitFor(f.actor, (s) => s.matches({ active: { selection: 'selectingOnly' } }))
		expect(select).toHaveBeenCalledWith('business')
	})
	it('does not silently switch when an explicit selected workspace is unavailable', async () => {
		const select = vi.fn<(id: string | null) => void>()
		const f = start(select)
		select.mockClear()
		f.actor.send({
			type: 'OBSERVED',
			observation: {
				...f.observation,
				source: { ...f.observation.source, organizationId: 'missing' },
				organizations: [workspace]
			}
		})
		await waitFor(f.actor, (s) => s.matches({ active: { selection: 'unavailableSelection' } }))
		expect(select).not.toHaveBeenCalled()
	})
	it('does not wait for an already-failed startup child and still drains the bank', () => {
		const f = start()
		startupObservation.mockImplementationOnce(() => {
			throw new Error('startup owner failed')
		})
		f.actor.send({ type: 'OBSERVED', observation: f.observation })
		expect(f.actor.getSnapshot().matches('closing')).toBe(true)
		expect(f.bank.getSnapshot().matches('closing')).toBe(true)
		f.actor.send({ type: 'SHUTDOWN' })
		f.bank.send({ type: 'SHUTDOWN' })
		expect(f.actor.getSnapshot().status).toBe('done')
	})
})
