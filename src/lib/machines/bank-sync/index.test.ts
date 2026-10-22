import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, createMachine, type ActorRefFrom } from 'xstate'
import type { OperationResult } from './operation.js'
import { createBankSyncMachine, selectBankView } from './index.js'
import { bankAvailabilityMachine } from './availability.js'
import { bankHistoryMachine } from './history.js'
import type { BankSource, BankSyncDependencies, Connection } from './types.js'

// The supervisor must wait for these resource-owning children to acknowledge cancellation.
vi.mock('./operation.js', () => ({ createBankOperationMachine: () => delayedOperation() }))
vi.mock('./setup.js', () => ({ createBankSetupMachine: () => delayedOperation() }))
function delayedOperation() {
	return createMachine({
		initial: 'working',
		states: {
			working: { on: { CANCEL: 'settling' } },
			settling: { on: { CANCEL: 'failed' } },
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
			type: 'OBSERVED',
			source: {
				...source,
				connections: [{ ...connection, lastSyncAt: new Date(), lastOutcome: 'succeeded' }]
			}
		})
		expect(actor.getSnapshot().hasTag('busy')).toBe(true)
		expect(child.getSnapshot().value).toBe('settling')
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'RESET' })
		expect(actor.getSnapshot().status).toBe('active')
		child.send({ type: 'CANCEL' })
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
		child.send({ type: 'CANCEL' })
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
		actor.send({ type: 'OBSERVED', source: { ...source, connections: [] } })
		expect(selectBankView(actor.getSnapshot()).mode).toEqual({
			kind: 'setup',
			stage: null,
			step: 0
		})
		actor.send({ type: 'OBSERVED', source: { ...source, membership: null } })
		expect(selectBankView(actor.getSnapshot()).mode).toEqual({ kind: 'restricted' })
		expect(actor.getSnapshot().children.operation).toBeUndefined()
	})
	it('preserves sync history independently while another explicit operation is running', () => {
		const actor = start()
		const at = new Date('2026-10-18T10:00:00Z')
		actor.send({
			type: 'OBSERVED',
			source: {
				...source,
				connections: [{ ...connection, lastSyncAt: at, lastOutcome: 'succeeded', importedCount: 3 }]
			}
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
		for (let i = 0; i < 3; i++) actor.send({ type: 'OBSERVED', source })
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
		child.send({ type: 'CANCEL' })
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
			child.send({ type: 'CANCEL' })
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
		child.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().matches({ ready: 'cancelled' })).toBe(true)
		expect(actor.getSnapshot().context.counts.imported).toBe(1)
		expect(warning).not.toHaveBeenCalledWith(expect.stringMatching(/^Event "CANCEL"/))
		subscription.unsubscribe()
		warning.mockRestore()
	})
})
