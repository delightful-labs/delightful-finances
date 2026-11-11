import { expect, it } from 'vitest'
import { selectedTransactionFacts } from './transaction-observation.js'
import {
	transactionCreateRoute,
	transactionEditRoute
} from '../../contracts/transaction-route-contract.js'

it('preserves the absence of an edit identity for creation observations', () => {
	const pathname = '/expenses/new'
	expect(transactionCreateRoute(pathname)).not.toBeNull()
	const facts = selectedTransactionFacts(
		transactionEditRoute(pathname),
		'expense',
		crypto.randomUUID(),
		undefined
	)
	expect(facts).toEqual({})
	expect(Object.hasOwn(facts, 'transactionId')).toBe(false)
})
it('retains an unresolved edit identity without exposing another kind of transaction', () => {
	const id = crypto.randomUUID(),
		route = transactionEditRoute(`/expenses/${id}`)
	expect(selectedTransactionFacts(route, 'expense', crypto.randomUUID(), undefined)).toEqual({
		transactionId: id,
		transaction: null
	})
	expect(selectedTransactionFacts(route, 'income', crypto.randomUUID(), undefined)).toEqual({})
})
