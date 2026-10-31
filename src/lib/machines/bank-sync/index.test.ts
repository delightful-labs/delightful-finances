import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, createMachine, type ActorRefFrom } from 'xstate'
import type { OperationResult } from './operation.js'
import { createBankSyncMachine, selectBankView } from './index.js'
import { bankAvailabilityMachine } from './availability.js'
import { bankHistoryMachine } from './history.js'
import { availabilityReport, publishBankSource } from './reports.fixture.js'
import type { BankSource, BankSyncDependencies, Connection } from './types.js'

const settlements = vi.hoisted(() => new WeakMap<object, () => void>())

// The supervisor must wait for these resource-owning children to acknowledge cancellation.
vi.mock('./logged-operation.js', () => ({
	createLoggedBankOperationMachine: () => delayedOperation()
}))
vi.mock('./setup.js', () => ({ createBankSetupMachine: () => delayedOperation() }))
function delayedOperation() {
	return createMachine({
		initial: 'working',
		entry: ({ self }) => {
			settlements.set(self, () => self.send({ type: 'FINISH' }))
		},
		states: {
			working: { on: { CANCEL: 'settling' } },
			settling: { on: { CANCEL: {}, FINISH: 'failed' } },
			failed: { type: 'final' }
		},
		output: (): OperationResult => ({
			kind: 'failed',
			error: new Error('private'),
			counts: { imported: 1, existing: 0, omitted: 0 },
			settlement: 'settled',
			discovered: undefined
		})
	})
}
function finish(actor: object) {
	const complete = settlements.get(actor)
	if (!complete) throw new Error('Expected controlled settlement actor')
	complete()
}
const connection: Connection = {
	id: 'connection',
	organizationId: 'organization',
	ownerId: 'owner',
	status: 'active',
	accessUrl: '',
	credentialVersion: 1,
	credentialId: 'credential',
	prfSalt: 'salt',
	iv: 'iv',
	ciphertext: 'ciphertext',
	lastOutcome: null,
	lastSyncAt: null,
	lastError: null,
	importedCount: null,
	existingCount: null,
	omittedCount: null,
	claimedAt: new Date()
}
const source: BankSource = {
	userId: 'owner',
	organizationId: 'organization',
	sessionReady: true,
	membership: {
		id: 'membership',
		profileId: null,
		organizationId: 'organization',
		userId: 'owner',
		role: 'owner',
		accountAccessMode: 'all'
	},
	connections: [connection],
	accounts: [],
	links: []
}
const dependencies: BankSyncDependencies = {
	db: vi.fn<() => BankSyncDependencies['db']>()(),
	read: () => source,
	passkeyName: () => 'Test'
}
const actors: ActorRefFrom<ReturnType<typeof createBankSyncMachine>>[] = []
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
	vi.restoreAllMocks()
})
function start(
	actorsOverride: Parameters<ReturnType<typeof createBankSyncMachine>['provide']>[0] = {}
) {
	const actor = createActor(createBankSyncMachine(dependencies).provide(actorsOverride)).start()
	actors.push(actor)
	if (actor.getSnapshot().status === 'active') publishBankSource(actor, source, 0)
	return actor
}
function unavailable(): never {
	throw new Error('private')
}

describe('bank supervisor error boundaries', () => {
	it('closes safely if availability cannot start', () => {
		const actor = start({
			actors: {
				availability: bankAvailabilityMachine.provide({ guards: { accessAllowed: unavailable } })
			}
		})
		expect(actor.getSnapshot().status).toBe('done')
		expect(actor.getSnapshot().context.setupToken).toBeUndefined()
	})

	it.each(['DISCOVER', 'CONNECT'])('settles %s cleanup when history fails', (command) => {
		const actor = start({
			actors: { history: bankHistoryMachine.provide({ actions: { summarize: unavailable } }) }
		})
		if (command === 'DISCOVER') actor.send({ type: 'DISCOVER' })
		else actor.send({ type: 'CONNECT', token: 'secret-token' })
		const child = actor.getSnapshot().children.operation ?? actor.getSnapshot().children.setup
		if (!child) throw new Error('Expected operation child')
		actor.send({
			type: 'HISTORY_CHANGED',
			revision: 0,
			records: [{ ...connection, lastSyncAt: new Date(), lastOutcome: 'succeeded' }]
		})
		expect(actor.getSnapshot().hasTag('busy')).toBe(true)
		expect(child.getSnapshot().value).toBe('settling')
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'RESET' })
		expect(actor.getSnapshot().status).toBe('active')
		finish(child)
		expect(actor.getSnapshot().status).toBe('done')
		expect(actor.getSnapshot().context.setupToken).toBeUndefined()
		expect(actor.getSnapshot().context.command).toBeUndefined()
		expect(selectBankView(actor.getSnapshot()).providerAccounts).toEqual([])
	})

	it.each(['DISCOVER', 'CONNECT'])('keeps shutdown priority over late %s failure', (command) => {
		const actor = start()
		if (command === 'DISCOVER') actor.send({ type: 'DISCOVER' })
		else actor.send({ type: 'CONNECT', token: 'secret-token' })
		const child = actor.getSnapshot().children.operation ?? actor.getSnapshot().children.setup
		if (!child) throw new Error('Expected operation child')
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'RESET' })
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().status).toBe('active')
		finish(child)
		expect(actor.getSnapshot().status).toBe('done')
		expect(actor.getSnapshot().context.error).toBeUndefined()
	})
})

describe('discriminated bank presentation', () => {
	it('projects exclusive setup, connected and restricted modes from existing availability states', () => {
		const actor = start()
		expect(selectBankView(actor.getSnapshot()).mode).toEqual({
			kind: 'connected',
			recovery: 'available'
		})
		publishBankSource(actor, { ...source, connections: [] }, 0)
		expect(selectBankView(actor.getSnapshot()).mode).toEqual({
			kind: 'setup',
			stage: null,
			step: 0
		})
		publishBankSource(actor, { ...source, membership: null }, 1)
		expect(selectBankView(actor.getSnapshot()).mode).toEqual({ kind: 'restricted' })
		expect(actor.getSnapshot().children.operation).toBeUndefined()
	})
	it('preserves sync history independently while another explicit operation is running', () => {
		const actor = start()
		const at = new Date('2026-10-18T10:00:00Z')
		actor.send({
			type: 'HISTORY_CHANGED',
			revision: 0,
			records: [{ ...connection, lastSyncAt: at, lastOutcome: 'succeeded', importedCount: 3 }]
		})
		const history = selectBankView(actor.getSnapshot()).history
		expect(history).toMatchObject({ time: at, outcomeKey: 'bank.succeeded', imported: 3 })
		expect(selectBankView(actor.getSnapshot()).activity).toEqual({ kind: 'idle' })
		actor.send({ type: 'DISCOVER' })
		expect(selectBankView(actor.getSnapshot()).activity.kind).toBe('working')
		expect(selectBankView(actor.getSnapshot()).history).toEqual(history)
	})
	it('does not start provider work from repeated observations', () => {
		const actor = start()
		const generation = actor.getSnapshot().context.generation
		for (let i = 0; i < 3; i++) publishBankSource(actor, source, 0)
		expect(actor.getSnapshot().context.generation).toBe(generation)
		expect(actor.getSnapshot().children.operation).toBeUndefined()
		expect(actor.getSnapshot().children.setup).toBeUndefined()
		expect(selectBankView(actor.getSnapshot()).activity).toEqual({ kind: 'idle' })
	})
})

describe('operation settlement handoff', () => {
	it('replaces the last progress report with final counts even when cancellation wins over child failure', () => {
		const actor = start()
		actor.send({ type: 'SYNC' })
		const child = actor.getSnapshot().children.operation
		if (!child) throw new Error('Expected operation')
		actor.send({ type: 'IMPORT_PROGRESS', counts: { imported: 0, existing: 0, omitted: 0 } })
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().hasTag('busy')).toBe(true)
		finish(child)
		expect(actor.getSnapshot().matches({ ready: 'cancelled' })).toBe(true)
		expect(actor.getSnapshot().context.counts).toEqual({ imported: 1, existing: 0, omitted: 0 })
	})
	it.each(['RESET', 'SHUTDOWN'] satisfies ('RESET' | 'SHUTDOWN')[])(
		'ignores late progress during %s and scrubs old counts after settlement',
		(intent) => {
			const actor = start()
			actor.send({ type: 'SYNC' })
			const child = actor.getSnapshot().children.operation
			if (!child) throw new Error('Expected operation')
			actor.send({ type: intent })
			actor.send({ type: 'IMPORT_PROGRESS', counts: { imported: 99, existing: 99, omitted: 99 } })
			actor.send({ type: 'CANCEL' })
			expect(actor.getSnapshot().context.counts).toEqual({ imported: 0, existing: 0, omitted: 0 })
			expect(actor.getSnapshot().hasTag('busy')).toBe(true)
			finish(child)
			expect(actor.getSnapshot().context.counts).toEqual({ imported: 0, existing: 0, omitted: 0 })
			expect(actor.getSnapshot().status).toBe(intent === 'SHUTDOWN' ? 'done' : 'active')
			if (intent === 'RESET') expect(actor.getSnapshot().matches({ ready: 'neutral' })).toBe(true)
		}
	)
	it('uses queued completion without sending cancellation to an already-completed operation', () => {
		const actor = start()
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
		actor.send({ type: 'SYNC' })
		const child = actor.getSnapshot().children.operation
		if (!child) throw new Error('Expected operation')
		const subscription = child.subscribe((snapshot) => {
			if (snapshot.status === 'done') actor.send({ type: 'CANCEL' })
		})
		child.send({ type: 'CANCEL' })
		finish(child)
		expect(actor.getSnapshot().matches({ ready: 'cancelled' })).toBe(true)
		expect(actor.getSnapshot().context.counts.imported).toBe(1)
		expect(warning).not.toHaveBeenCalledWith(expect.stringMatching(/^Event "CANCEL"/))
		subscription.unsubscribe()
		warning.mockRestore()
	})
})

describe('bank report currency and command gating', () => {
	function delayedAvailability() {
		return start({
			actors: { availability: bankAvailabilityMachine.provide({ actions: { publish: () => {} } }) }
		})
	}
	function report(actor: ReturnType<typeof start>, observed: BankSource = source) {
		return availabilityReport(observed, actor.getSnapshot().context.generation)
	}
	it('waits for the actual child report at startup before allowing commands', () => {
		const actor = delayedAvailability()
		expect(selectBankView(actor.getSnapshot()).mode.kind).toBe('restricted')
		actor.send({ type: 'SYNC' })
		actor.send({ type: 'CONNECT', token: 'secret' })
		expect(actor.getSnapshot().hasTag('busy')).toBe(false)
		expect(actor.getSnapshot().context.setupToken).toBeUndefined()
		actor.send({ type: 'AVAILABILITY_REPORTED', report: report(actor) })
		actor.send({ type: 'SYNC' })
		expect(actor.getSnapshot().children.operation).toBeDefined()
	})
	it('invalidates capabilities and history before a replacement report arrives', () => {
		const actor = delayedAvailability()
		const previous = report(actor)
		actor.send({ type: 'AVAILABILITY_REPORTED', report: previous })
		const summary = {
			time: new Date(),
			outcomeKey: 'bank.succeeded',
			imported: 2,
			existing: 0,
			omitted: 0
		} satisfies NonNullable<ReturnType<typeof selectBankView>['history']>
		actor.send({ type: 'HISTORY_REPORTED', revision: 0, connectionId: connection.id, summary })
		expect(selectBankView(actor.getSnapshot()).history?.imported).toBe(2)
		const revoked = { ...source, membership: null }
		publishBankSource(actor, revoked, 1)
		expect(actor.getSnapshot().context.availability).toBeUndefined()
		expect(selectBankView(actor.getSnapshot()).history).toBeUndefined()
		actor.send({ type: 'SYNC' })
		actor.send({ type: 'CONNECT', token: 'secret' })
		expect(actor.getSnapshot().hasTag('busy')).toBe(false)
		actor.send({ type: 'AVAILABILITY_REPORTED', report: previous })
		actor.send({
			type: 'HISTORY_REPORTED',
			revision: 0,
			connectionId: connection.id,
			summary: { ...summary, imported: 99 }
		})
		expect(actor.getSnapshot().context.availability).toBeUndefined()
		expect(selectBankView(actor.getSnapshot()).history).toBeUndefined()
		actor.send({ type: 'AVAILABILITY_REPORTED', report: report(actor, revoked) })
		expect(selectBankView(actor.getSnapshot()).mode.kind).toBe('restricted')
	})
	it('rejects prior visits and scoped data after A → B → A', () => {
		const actor = delayedAvailability()
		const first = report(actor)
		actor.send({ type: 'AVAILABILITY_REPORTED', report: first })
		const other = { ...source, userId: 'other-owner', membership: null }
		publishBankSource(actor, other, 1)
		const second = report(actor, other)
		publishBankSource(actor, source, 2)
		for (const stale of [first, second])
			actor.send({ type: 'AVAILABILITY_REPORTED', report: stale })
		for (const revision of [0, 1]) {
			actor.send({
				type: 'HISTORY_REPORTED',
				revision,
				connectionId: connection.id,
				summary: {
					time: new Date(),
					outcomeKey: 'bank.succeeded',
					imported: 99,
					existing: 0,
					omitted: 0
				}
			})
			actor.send({ type: 'CONNECTIONS_CHANGED', revision, connections: [] })
		}
		expect(actor.getSnapshot().context.connection?.id).toBe(connection.id)
		expect(actor.getSnapshot().context.availability).toBeUndefined()
		expect(selectBankView(actor.getSnapshot()).history).toBeUndefined()
		actor.send({ type: 'SYNC' })
		expect(actor.getSnapshot().children.operation).toBeUndefined()
		actor.send({ type: 'AVAILABILITY_REPORTED', report: report(actor) })
		expect(selectBankView(actor.getSnapshot()).mode.kind).toBe('connected')
		actor.send({ type: 'SYNC' })
		expect(actor.getSnapshot().children.operation).toBeDefined()
	})
	it('updates history without reassessing availability or replacing mapping actors', () => {
		const actor = start()
		const before = actor.getSnapshot()
		actor.send({
			type: 'HISTORY_CHANGED',
			revision: 0,
			records: [{ ...connection, lastSyncAt: new Date(), lastOutcome: 'failed' }]
		})
		expect(actor.getSnapshot().context.generation).toBe(before.context.generation)
		expect(actor.getSnapshot().context.availability).toBe(before.context.availability)
		expect(actor.getSnapshot().context.mappingActors).toBe(before.context.mappingActors)
		expect(selectBankView(actor.getSnapshot()).history?.outcomeKey).toBe('bank.failed')
	})
	it.each(['authority', 'credential'])('drains an active operation when %s changes', (change) => {
		const actor = start()
		actor.send({ type: 'SYNC' })
		const child = actor.getSnapshot().children.operation
		if (!child) throw new Error('Expected operation')
		const replacement =
			change === 'authority'
				? { ...source, membership: null }
				: { ...source, connections: [{ ...connection, ciphertext: 'replacement' }] }
		publishBankSource(actor, replacement, change === 'authority' ? 1 : 0)
		expect(child.getSnapshot().value).toBe('settling')
		expect(actor.getSnapshot().hasTag('busy')).toBe(true)
		finish(child)
		expect(actor.getSnapshot().hasTag('busy')).toBe(false)
		expect(selectBankView(actor.getSnapshot()).mode.kind).toBe(
			change === 'authority' ? 'restricted' : 'connected'
		)
	})
	it.each(['DISCOVER', 'CONNECT'])('drains %s when availability fails after startup', (command) => {
		let broken = false
		const actor = start({
			actors: {
				availability: bankAvailabilityMachine.provide({
					guards: {
						accessAllowed: () => {
							if (broken) return unavailable()
							return true
						}
					}
				})
			}
		})
		if (command === 'DISCOVER') actor.send({ type: 'DISCOVER' })
		else actor.send({ type: 'CONNECT', token: 'secret' })
		const child = actor.getSnapshot().children.operation ?? actor.getSnapshot().children.setup
		if (!child) throw new Error('Expected active work')
		broken = true
		actor.send({
			type: 'CONNECTIONS_CHANGED',
			revision: 0,
			connections: [{ ...connection, ciphertext: 'replacement' }]
		})
		expect(child.getSnapshot().value).toBe('settling')
		expect(actor.getSnapshot().status).toBe('active')
		actor.send({ type: 'RESET' })
		actor.send({ type: 'CANCEL' })
		finish(child)
		expect(actor.getSnapshot().status).toBe('done')
	})
	it('does not let current or stale reports interrupt shutdown or start provider work', () => {
		const actor = start()
		const current = report(actor)
		actor.send({ type: 'SYNC' })
		const child = actor.getSnapshot().children.operation
		if (!child) throw new Error('Expected operation')
		actor.send({ type: 'SHUTDOWN' })
		publishBankSource(actor, source, 1)
		actor.send({ type: 'AVAILABILITY_REPORTED', report: current })
		actor.send({ type: 'SYNC' })
		actor.send({ type: 'RESET' })
		expect(child.getSnapshot().value).toBe('settling')
		expect(actor.getSnapshot().matches({ running: 'shuttingDown' })).toBe(true)
		finish(child)
		expect(actor.getSnapshot().status).toBe('done')
	})
})
