import { describe, expect, it } from 'vitest'
import { createActor, getInitialSnapshot } from 'xstate'
import { bankAvailabilityMachine } from './availability.js'
import { accountOptionsMachine } from './account-options.js'
import { bankHistoryMachine } from './history.js'
import { account, connection, id, source } from './test-fixtures.js'
import type { BankSource } from './types.js'

describe('bank availability and presentation decisions', () => {
	it.each([
		{ name: 'transitioning session', change: { sessionReady: false } },
		{ name: 'missing user', change: { userId: undefined } },
		{ name: 'missing organization', change: { organizationId: null } },
		{ name: 'missing membership', change: { membership: undefined } },
		{
			name: 'another identity membership',
			change: { membership: { ...source.membership!, userId: id(8) } }
		},
		{ name: 'viewer', change: { membership: { ...source.membership!, role: 'viewer' } } }
	] satisfies { name: string; change: Partial<BankSource> }[])('denies $name', ({ change }) => {
		const state = getInitialSnapshot(bankAvailabilityMachine, { ...source, ...change })
		expect(state.hasTag('allowed')).toBe(false)
		expect(state.hasTag('show-sync')).toBe(false)
		expect(state.hasTag('show-restricted')).toBe(true)
	})

	it('revokes sync controls when ciphertext becomes incomplete and restores them only from a fresh observation', () => {
		const actor = createActor(bankAvailabilityMachine, { input: source }).start()
		expect(actor.getSnapshot().hasTag('show-sync')).toBe(true)
		actor.send({
			type: 'OBSERVED',
			source: { ...source, connections: [{ ...connection, ciphertext: null }] }
		})
		expect(actor.getSnapshot().hasTag('show-sync')).toBe(false)
		expect(actor.getSnapshot().hasTag('show-setup')).toBe(true)
		actor.send({ type: 'OBSERVED', source })
		expect(actor.getSnapshot().hasTag('show-sync')).toBe(true)
		actor.stop()
	})

	it('hides sync during setup and rechecks access before restoring controls', () => {
		const actor = createActor(bankAvailabilityMachine, { input: source }).start()
		actor.send({ type: 'SETUP_STARTED' })
		expect(actor.getSnapshot().hasTag('show-sync')).toBe(false)
		actor.send({ type: 'OBSERVED', source: { ...source, sessionReady: false } })
		actor.send({ type: 'SETUP_ENDED' })
		expect(actor.getSnapshot().hasTag('show-sync')).toBe(false)
		actor.stop()
	})

	it('excludes accounts already assigned to another provider and identifies broken links', () => {
		const input = {
			provider: { id: 'checking', name: 'Provider', currency: 'USD' },
			accounts: [account, { ...account, id: id(6) }],
			mappings: new Map([
				['savings', account.id],
				['checking', id(7)]
			])
		}
		const state = getInitialSnapshot(accountOptionsMachine, input)
		expect(state.context.mapping).toEqual({ kind: 'broken' })
		expect(state.context.eligibleAccounts.map((row) => row.id)).toEqual([id(6)])
		expect(state.hasTag('show-existing')).toBe(true)
	})

	it('does not offer the current linked account as an alternative', () => {
		const state = getInitialSnapshot(accountOptionsMachine, {
			provider: { id: 'checking', name: 'Provider', currency: 'USD' },
			accounts: [account],
			mappings: new Map([['checking', account.id]])
		})
		expect(state.context.mapping).toEqual({ kind: 'linked', account })
		expect(state.hasTag('show-existing')).toBe(false)
	})

	it.each(['succeeded', 'partial', 'failed'])(
		'projects persisted %s results independently of the current operation',
		(outcome) => {
			const lastOutcome =
				outcome === 'succeeded' ? 'succeeded' : outcome === 'partial' ? 'partial' : 'failed'
			const state = getInitialSnapshot(bankHistoryMachine, {
				...connection,
				lastOutcome,
				lastSyncAt: new Date('2026-10-17'),
				importedCount: 2,
				existingCount: 3,
				omittedCount: 4
			})
			expect(state.context.summary).toEqual({
				time: new Date('2026-10-17'),
				outcomeKey: `bank.${outcome}`,
				imported: 2,
				existing: 3,
				omitted: 4
			})
		}
	)
})
