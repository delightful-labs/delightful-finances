import { expect, it } from 'vitest'
import { transactionCreateRoute, transactionEditRoute } from './transaction-route-contract.js'

it('distinguishes creation from canonical expense and income edit routes', () => {
	const id = crypto.randomUUID()
	expect(transactionCreateRoute('/expenses/new')).toEqual({
		kind: 'expense',
		pathname: '/expenses/new'
	})
	expect(transactionEditRoute('/expenses/new')).toBeNull()
	for (const [path, kind] of [
		['expenses', 'expense'],
		['income', 'income']
	]) {
		const pathname = `/${path}/${id}`
		expect(transactionEditRoute(pathname)).toEqual({ kind, pathname, transactionId: id })
		expect(transactionCreateRoute(pathname)).toBeNull()
	}
})
it('does not acquire a selected entity lease from malformed or unrelated paths', () => {
	const id = crypto.randomUUID()
	for (const path of [
		`/accounts/${id}`,
		`/expenses/${id}/edit`,
		`/expenses/${id}/`,
		`/expenses/${id}?workspace=private`,
		'/expenses/%2e%2e',
		'/expenses/not-an-id',
		'//income/' + id
	])
		expect(transactionEditRoute(path)).toBeNull()
})
