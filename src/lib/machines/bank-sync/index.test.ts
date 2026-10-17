import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, createMachine, type ActorRefFrom } from 'xstate'
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
		output: () => ({
			kind: 'failed',
			error: new Error('private'),
			counts: { imported: 1, existing: 0, omitted: 0 }
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
