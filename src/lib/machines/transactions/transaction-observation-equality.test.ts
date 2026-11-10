import { expect, it } from 'vitest'
import { creationFacts } from './transaction-create.fixture.js'
import { sameTransactionEntryObservation } from './transaction-entry.js'

it('keeps a repeated copied observation current without reopening authorization', () => {
	const facts = creationFacts({})
	expect(sameTransactionEntryObservation(facts, { ...facts })).toBe(true)
})
it('requires reassessment after scope, readiness, membership or query-lease changes', () => {
	const facts = creationFacts({})
	for (const changed of [
		{ ...facts, binding: {} },
		{ ...facts, sessionReady: false },
		{ ...facts, loading: true },
		{ ...facts, failed: true },
		{ ...facts, membership: null },
		{ ...facts, grants: [...facts.grants] },
		{ ...facts, accounts: [...facts.accounts] },
		{ ...facts, categories: [...facts.categories] },
		{ ...facts, tags: [...facts.tags] },
		{ ...facts, transactionId: crypto.randomUUID() }
	])
		expect(sameTransactionEntryObservation(facts, changed)).toBe(false)
})
