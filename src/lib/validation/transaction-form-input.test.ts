import { describe, expect, it } from 'vitest'
import type { Account, Category } from '../schema.js'
import { transactionFormSchema } from './transaction-form-input.js'

type Options = ReturnType<Parameters<typeof transactionFormSchema>[0]>
const account: Account = {
	id: 'account',
	organizationId: 'workspace',
	name: 'Checking',
	kind: 'bank',
	currency: 'USD',
	archivedAt: null
}
const category: Category = {
	id: 'category',
	organizationId: 'workspace',
	name: 'Groceries',
	kind: 'expense',
	isSystem: false,
	archivedAt: null
}
const fields = {
	accountId: account.id,
	categoryId: category.id,
	amount: '12.34',
	bookedOn: '2026-10-13',
	memo: '  Market  '
}

function options(kind: Options['kind'] = 'expense'): Options {
	return {
		organizationId: account.organizationId,
		kind,
		accounts: [account],
		categories: [{ ...category, kind }]
	}
}

describe('transaction form schema', () => {
	it('derives domain fields from current rows and ignores injected domain values', () => {
		const schema = transactionFormSchema(() => options())
		expect(
			schema.parse({
				...fields,
				kind: 'income',
				organizationId: 'other',
				currency: 'EUR',
				source: 'simplefin'
			})
		).toEqual({
			accountId: account.id,
			categoryId: category.id,
			organizationId: account.organizationId,
			kind: 'expense',
			money: { amountMinor: 1234, currency: 'USD' },
			bookedOn: fields.bookedOn,
			memo: 'Market',
			source: { source: 'manual' }
		})
	})

	it.each(['', '-1', '1.234', '1e3', '21474836.48'])('rejects invalid amount %j', (amount) => {
		expect(transactionFormSchema(() => options()).safeParse({ ...fields, amount }).success).toBe(
			false
		)
	})

	it('accepts zero, omits blank memo, and uses the account currency', () => {
		const schema = transactionFormSchema(() => ({
			...options(),
			accounts: [{ ...account, currency: 'EUR' }]
		}))
		const result = schema.parse({ ...fields, amount: '0', memo: '  ' })
		expect(result.money).toEqual({ amountMinor: 0, currency: 'EUR' })
		expect(result).not.toHaveProperty('memo')
	})

	it.each(['2026-02-29', '2026-13-01', '10/13/2026', ''])(
		'rejects invalid booked date %j',
		(bookedOn) => {
			expect(
				transactionFormSchema(() => options()).safeParse({ ...fields, bookedOn }).success
			).toBe(false)
		}
	)

	it('accepts a leap-day calendar date', () => {
		expect(
			transactionFormSchema(() => options()).parse({ ...fields, bookedOn: '2028-02-29' }).bookedOn
		).toBe('2028-02-29')
	})

	it.each(['cash', 'transfer', 'electronic'])(
		'creates %s income without check details',
		(paymentMethod) => {
			const result = transactionFormSchema(() => options('income')).parse({
				...fields,
				paymentMethod,
				checkNumber: '',
				checkDate: 'invalid'
			})
			expect(result).toMatchObject({ kind: 'income', paymentMethod })
			expect(result).not.toHaveProperty('checkDetails')
		}
	)

	it('defaults income to cash when no payment method is submitted', () => {
		expect(transactionFormSchema(() => options('income')).parse(fields)).toMatchObject({
			kind: 'income',
			paymentMethod: 'cash'
		})
	})

	it('trims check numbers and omits an empty optional check date', () => {
		const result = transactionFormSchema(() => options('income')).parse({
			...fields,
			paymentMethod: 'check',
			checkNumber: '  123  ',
			checkDate: ''
		})
		expect(result).toMatchObject({
			kind: 'income',
			paymentMethod: 'check',
			checkDetails: { checkNumber: '123' }
		})
		if ('checkDetails' in result) expect(result.checkDetails).not.toHaveProperty('checkDate')
	})

	it.each([
		{ checkNumber: '' },
		{ checkNumber: ' ' },
		{ checkNumber: '123', checkDate: '2026-02-29' }
	])('rejects invalid check details %j', (details) => {
		expect(
			transactionFormSchema(() => options('income')).safeParse({
				...fields,
				paymentMethod: 'check',
				...details
			}).success
		).toBe(false)
	})

	it.each([
		{ name: 'missing account', values: { accounts: [] } },
		{ name: 'missing category', values: { categories: [] } },
		{ name: 'no workspace', values: { organizationId: null } },
		{ name: 'foreign account', values: { accounts: [{ ...account, organizationId: 'other' }] } },
		{
			name: 'foreign category',
			values: { categories: [{ ...category, organizationId: 'other' }] }
		},
		{ name: 'archived account', values: { accounts: [{ ...account, archivedAt: new Date() }] } },
		{
			name: 'archived category',
			values: { categories: [{ ...category, archivedAt: new Date() }] }
		},
		{ name: 'wrong category kind', values: { kind: 'income' } }
	] satisfies { name: string; values: Partial<Options> }[])('rejects $name', ({ values }) => {
		expect(
			transactionFormSchema(() => ({ ...options(), ...values })).safeParse(fields).success
		).toBe(false)
	})

	it('reads current options on every validation', () => {
		let current = options()
		const schema = transactionFormSchema(() => current)
		expect(schema.parse(fields).kind).toBe('expense')
		current = options('income')
		expect(schema.parse(fields).kind).toBe('income')
		current = { ...current, accounts: [] }
		expect(schema.safeParse(fields).success).toBe(false)
	})
})
