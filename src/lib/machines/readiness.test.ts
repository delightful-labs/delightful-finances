import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assign, createActor, createMachine, setup, sendTo, waitFor } from 'xstate'
import type {
	InitializationRequest,
	InitializationStatusEvent,
	InitializationRecipient
} from '../workspace-orchestration-contract.js'
import type {
	IntegrityRequest,
	IntegrityRecipient,
	IntegrityStatus,
	IntegrityReport
} from '../workspace-integrity-contract.js'
import type { CreationBinding } from './workspace-creation-operation.js'
import {
	createWorkspaceReadinessMachine,
	selectWorkspaceView,
	type ReadinessObservation,
	type WorkspaceAttachment
} from './readiness.js'
import { scope, membership, records } from './workspace-integrity.fixture.js'

const { bankStart, bankObservation, startupObservation } = vi.hoisted(() => ({
	bankStart: vi.fn(),
	bankObservation: vi.fn(),
	startupObservation: vi.fn()
}))
vi.mock('./workspace-startup.js', () => ({
	createWorkspaceStartupMachine: () => {
		type Input = { request: InitializationRequest; recipient: InitializationRecipient }
		return setup<
			Input,
			| { type: 'OBSERVED'; request: InitializationRequest }
			| { type: 'SHUTDOWN' | 'FINISH' | 'FAIL' },
			{},
			{},
			{},
			{},
			never,
			string,
			Input
		>({}).createMachine({
			context: ({ input }) => input,
			initial: 'checking',
			on: {
				OBSERVED: {
					target: '.checking',
					actions: [assign({ request: ({ event }) => event.request }), startupObservation]
				},
				SHUTDOWN: '.closing'
			},
			states: {
				checking: {
					always: [
						{ guard: ({ context }) => context.request.status === 'ready', target: 'ready' },
						{ target: 'waiting' }
					]
				},
				ready: {
					entry: sendTo(
						({ context }) => context.recipient,
						({ context }): InitializationStatusEvent => ({
							type: 'INITIALIZATION_STATUS',
							report: {
								request: context.request,
								status: { kind: 'ready', profileId: '22222222-2222-4222-8222-222222222222' }
							}
						})
					),
					on: { FAIL: 'failed' }
				},
				waiting: {
					entry: sendTo(
						({ context }) => context.recipient,
						({ context }): InitializationStatusEvent => ({
							type: 'INITIALIZATION_STATUS',
							report: { request: context.request, status: { kind: 'waiting' } }
						})
					)
				},
				failed: {
					entry: sendTo(
						({ context }) => context.recipient,
						({ context }): InitializationStatusEvent => ({
							type: 'INITIALIZATION_STATUS',
							report: { request: context.request, status: { kind: 'failed' } }
						})
					)
				},
				closing: { on: { FINISH: 'closed', OBSERVED: {}, SHUTDOWN: {} } },
				closed: { type: 'final' }
			}
		})
	}
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
vi.mock('./workspace-integrity-owner.js', () => ({
	createWorkspaceIntegrityOwner: () => {
		type Input = { request: IntegrityRequest; recipient: IntegrityRecipient }
		return setup<
			Input,
			{ type: 'OBSERVED'; request: IntegrityRequest } | { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' },
			{},
			{},
			{},
			{},
			never,
			string,
			Input
		>({}).createMachine({
			context: ({ input }) => input,
			initial: 'active',
			on: { OBSERVED: { actions: assign({ request: ({ event }) => event.request }) } },
			states: {
				active: { on: { SHUTDOWN: 'closed', HOLD: 'held' } },
				held: { on: { SHUTDOWN: 'draining' } },
				draining: { on: { FINISH: 'closed' } },
				closed: { type: 'final' }
			}
		})
	}
}))
vi.mock('./workspace-creation.js', async () => {
	const actual =
		await vi.importActual<typeof import('./workspace-creation.js')>('./workspace-creation.js')
	return {
		...actual,
		selectWorkspaceCreationReport: (snapshot: {
			context: { binding: CreationBinding | undefined }
		}) => ({ binding: snapshot.context.binding, view: actual.unavailableWorkspaceCreationView }),
		createWorkspaceCreationMachine: () =>
			setup<
				{ binding: CreationBinding | undefined },
				| { type: 'OBSERVED'; binding: CreationBinding | undefined }
				| { type: 'HOLD' | 'FINISH' | 'SHUTDOWN' },
				{},
				{},
				{},
				{},
				never,
				string,
				{ binding: CreationBinding | undefined }
			>({}).createMachine({
				context: ({ input }) => input,
				initial: 'active',
				on: { OBSERVED: { actions: assign({ binding: ({ event }) => event.binding }) } },
				states: {
					active: { on: { SHUTDOWN: 'closed', HOLD: 'held' } },
					held: { on: { SHUTDOWN: 'draining' } },
					draining: { on: { FINISH: 'closed' } },
					closed: { type: 'final' }
				}
			})
	}
})
const cleanup: (() => void)[] = []
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose()
})
beforeEach(() => {
	vi.clearAllMocks()
	bankStart.mockImplementation(() => {})
	bankObservation.mockImplementation(() => {})
	startupObservation.mockImplementation(() => {})
})
function start() {
	const observation: ReadinessObservation = {
		source: {
			userId: scope.userId,
			organizationId: null,
			sessionReady: true,
			membership: undefined,
			connections: [],
			accounts: [],
			links: []
		},
		sessionStatus: 'ready',
		membershipLoading: false,
		membershipError: undefined,
		organizations: [],
		organizationsLoading: false,
		organizationsError: undefined,
		route: { pathname: '/settings/workspace', search: '', hash: '' }
	}
	const navigate = vi.fn(async () => {})
	const attachment: WorkspaceAttachment = {
		environment: 'test',
		dependencies: {
			db: vi.fn<() => WorkspaceAttachment['dependencies']['db']>()(),
			read: () => observation.source,
			passkeyName: () => 'Test'
		},
		read: () => observation,
		navigate
	}
	const parent = createActor(
		createMachine({ invoke: { id: 'workspace', src: createWorkspaceReadinessMachine(attachment) } })
	).start()
	const candidate = parent.getSnapshot().children.workspace
	if (!candidate) throw new Error('Missing coordinator')
	const actor = candidate
	const { bank, startup, integrity, creation } = actor.getSnapshot().children
	if (!bank || !startup || !integrity || !creation) throw new Error('Missing owned children')
	cleanup.push(() => parent.stop())
	function observe(next: ReadinessObservation) {
		actor.send({ type: 'OBSERVED', observation: next })
	}
	function selected(
		id = scope.organizationId,
		overrides: Partial<ReadinessObservation> = {}
	): ReadinessObservation {
		return {
			...observation,
			organizations: records().organizations.map((row) => ({ ...row, id })),
			source: {
				...observation.source,
				organizationId: id,
				membership: { ...membership, organizationId: id }
			},
			route: { pathname: '/expenses', search: `?workspace=${id}`, hash: '' },
			...overrides
		}
	}
	function report(
		status: IntegrityStatus,
		request: IntegrityRequest = actor.getSnapshot().context.integrityRequest
	) {
		const report: IntegrityReport = { request, status }
		actor.send({ type: 'INTEGRITY_STATUS', report })
		return report
	}
	return {
		actor,
		bank,
		startup,
		integrity,
		creation,
		observation,
		navigate,
		observe,
		selected,
		report
	}
}
const sync = { type: 'BANK', event: { type: 'SYNC' } }

describe('workspace readiness supervision', () => {
	it('drains resource owners and navigation before completing shutdown', () => {
		const f = start()
		f.creation.send({ type: 'HOLD' })
		f.integrity.send({ type: 'HOLD' })
		f.actor.send({ type: 'SHUTDOWN' })
		f.bank.send({ type: 'SHUTDOWN' })
		f.startup.send({ type: 'FINISH' })
		expect(f.actor.getSnapshot().status).toBe('active')
		f.creation.send({ type: 'FINISH' })
		expect(f.actor.getSnapshot().status).toBe('active')
		f.integrity.send({ type: 'FINISH' })
		expect(f.actor.getSnapshot().status).toBe('done')
	})
	it('does not wait for acknowledgement from a bank that failed at startup', () => {
		bankStart.mockImplementationOnce(() => {
			throw new Error('private')
		})
		const f = start()
		f.startup.send({ type: 'FINISH' })
		expect(f.actor.getSnapshot().matches('failed')).toBe(true)
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.actor.getSnapshot().status).toBe('done')
	})
	it('drains remaining live children when the bank observer fails', () => {
		const f = start()
		bankObservation.mockImplementationOnce(() => {
			throw new Error('private')
		})
		f.observe(f.observation)
		f.startup.send({ type: 'FINISH' })
		expect(f.actor.getSnapshot().matches('failed')).toBe(true)
		f.observe(f.observation)
		expect(bankObservation).toHaveBeenCalledTimes(1)
	})
	it('treats unexpected bank completion as failure', () => {
		const f = start()
		f.actor.send({ type: 'BANK', event: { type: 'RESET' } })
		f.startup.send({ type: 'FINISH' })
		expect(f.actor.getSnapshot().matches('failed')).toBe(true)
		expect(selectWorkspaceView(f.actor.getSnapshot()).ready).toBe(false)
	})
	it('ignores observations and domain status while shutdown drains', () => {
		const f = start()
		f.observe(f.selected())
		const stale = f.report({ kind: 'complete', settlement: 'notStarted' })
		f.actor.send({ type: 'SHUTDOWN' })
		f.observe(f.observation)
		f.actor.send({ type: 'INTEGRITY_STATUS', report: stale })
		expect(selectWorkspaceView(f.actor.getSnapshot()).canSync).toBe(false)
		f.bank.send({ type: 'SHUTDOWN' })
		f.startup.send({ type: 'FINISH' })
		expect(f.actor.getSnapshot().status).toBe('done')
	})
	it('does not wait for an already failed startup owner', () => {
		const f = start()
		startupObservation.mockImplementationOnce(() => {
			throw new Error('startup owner failed')
		})
		f.observe({ ...f.observation, sessionStatus: 'transitioning' })
		expect(f.actor.getSnapshot().matches('closing')).toBe(true)
		f.actor.send({ type: 'SHUTDOWN' })
		f.bank.send({ type: 'SHUTDOWN' })
		expect(f.actor.getSnapshot().status).toBe('done')
	})
})
describe('workspace public capability and report currency', () => {
	it('requires current integrity and preserves usable versus blocked partial policy', () => {
		const f = start()
		f.observe(f.selected())
		expect(f.actor.getSnapshot().can(sync)).toBe(false)
		f.report({ kind: 'complete', settlement: 'notStarted' })
		expect(f.actor.getSnapshot().can(sync)).toBe(true)
		f.report({
			kind: 'partial',
			settlement: 'notStarted',
			issues: ['profileLink'],
			access: 'usable'
		})
		expect(f.actor.getSnapshot().can(sync)).toBe(true)
		f.report({
			kind: 'partial',
			settlement: 'notStarted',
			issues: ['profileLink'],
			access: 'blocked'
		})
		expect(f.actor.getSnapshot().can(sync)).toBe(false)
	})
	it('rejects prior-visit reports after A → B → A', () => {
		const f = start()
		f.observe(f.selected())
		const old = f.report({ kind: 'complete', settlement: 'notStarted' })
		f.observe(f.selected(scope.profileId))
		f.observe(f.selected())
		f.actor.send({ type: 'INTEGRITY_STATUS', report: old })
		expect(f.actor.getSnapshot().can(sync)).toBe(false)
		f.report({ kind: 'complete', settlement: 'notStarted' })
		expect(f.actor.getSnapshot().can(sync)).toBe(true)
	})
	it.each(['loading', 'error', 'role'])(
		'invalidates %s authority and never restores old status',
		(reason) => {
			const f = start()
			const selected = f.selected()
			f.observe(selected)
			const old = f.report({ kind: 'complete', settlement: 'notStarted' })
			const changed: ReadinessObservation =
				reason === 'loading'
					? { ...selected, membershipLoading: true }
					: reason === 'error'
						? { ...selected, membershipError: new Error('observer failed') }
						: {
								...selected,
								source: { ...selected.source, membership: { ...membership, role: 'member' } }
							}
			f.observe(changed)
			f.observe(selected)
			f.actor.send({ type: 'INTEGRITY_STATUS', report: old })
			expect(f.actor.getSnapshot().can(sync)).toBe(false)
			f.report({ kind: 'complete', settlement: 'notStarted' })
			expect(f.actor.getSnapshot().can(sync)).toBe(true)
		}
	)
	it('does not restart equivalent observations but assigns a fresh generation to explicit retry', () => {
		const f = start()
		const selected = f.selected()
		f.observe(selected)
		const before: IntegrityRequest = f.actor.getSnapshot().context.integrityRequest
		f.observe(selected)
		expect(f.actor.getSnapshot().context.integrityRequest).toEqual(before)
		f.report({ kind: 'failed', settlement: 'notStarted' })
		f.actor.send({ type: 'RETRY_INTEGRITY' })
		expect(f.actor.getSnapshot().context.integrityRequest.generation).toBe(before.generation + 1)
		expect(f.actor.getSnapshot().context.integrityReport).toBeUndefined()
	})
	it('rejects a report for another binding even if its generation matches', () => {
		const f = start()
		f.observe(f.selected())
		const request: IntegrityRequest = f.actor.getSnapshot().context.integrityRequest
		if (!request.binding) throw new Error('Missing binding')
		f.report(
			{ kind: 'complete', settlement: 'notStarted' },
			{ ...request, binding: { ...request.binding, organizationId: scope.profileId } }
		)
		expect(f.actor.getSnapshot().can(sync)).toBe(false)
	})
	it.each([
		'?workspace=invalid',
		'?workspace=',
		`?workspace=${scope.organizationId}&workspace=${scope.organizationId}`
	])('denies explicit malformed scope %s without navigation fallback', async (search) => {
		const f = start()
		f.observe({
			...f.selected(),
			route: { pathname: '/expenses', search, hash: '' },
			source: { ...f.observation.source, organizationId: null }
		})
		await waitFor(f.actor, (s) => selectWorkspaceView(s).navigation === 'unavailable')
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('denies retained workspace rows after membership disappears', async () => {
		const f = start()
		const selected = f.selected()
		f.observe(selected)
		f.observe({ ...selected, source: { ...selected.source, membership: undefined } })
		await waitFor(f.actor, (s) => selectWorkspaceView(s).navigation === 'unavailable')
		expect(f.actor.getSnapshot().can(sync)).toBe(false)
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('retries initialization without replacing unrelated owners and ignores old identity reports', async () => {
		const f = start()
		const oldRequest: InitializationRequest = f.actor.getSnapshot().context.initializationRequest
		f.startup.send({ type: 'FAIL' })
		f.actor.send({ type: 'RETRY' })
		await waitFor(f.actor, (s) => selectWorkspaceView(s).ready)
		expect(f.actor.getSnapshot().children.bank).toBe(f.bank)
		f.actor.send({
			type: 'INITIALIZATION_STATUS',
			report: { request: oldRequest, status: { kind: 'failed' } }
		})
		expect(selectWorkspaceView(f.actor.getSnapshot()).ready).toBe(true)
	})
	it('keeps creation alive when only the selected workspace changes', () => {
		const f = start()
		f.observe(f.selected())
		f.creation.send({ type: 'HOLD' })
		f.observe(f.selected(scope.profileId))
		expect(f.actor.getSnapshot().children.creation).toBe(f.creation)
		expect(f.creation.getSnapshot().matches('held')).toBe(true)
	})
	it('supports workspace management without a selected workspace or bank setup', () => {
		const f = start()
		expect(selectWorkspaceView(f.actor.getSnapshot()).ready).toBe(true)
		expect(selectWorkspaceView(f.actor.getSnapshot()).navigation).toBe('directory')
		expect(f.navigate).not.toHaveBeenCalled()
	})
})
