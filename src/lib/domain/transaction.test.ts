import { describe, expect, it } from 'vitest'
import { validateTransaction, type AppTransaction } from './transaction.js'

const checkIncome: AppTransaction = {
	kind: 'income',
	source: { source: 'manual' },
	paymentMethod: 'check',
	money: { amountMinor: 2500, currency: 'USD' },
	accountId: 'account-1',
	organizationId: 'organization-1',
	categoryId: 'category-1',
	bookedOn: '2026-10-11',
	checkDetails: { checkNumber: '101', checkDate: '2026-10-11' }
}

describe('validateTransaction', () => {
	it('accepts a complete check-income transaction', () => {
		expect(validateTransaction(checkIncome)).toBeNull()
	})

	it('requires check details and a valid check date for check income', () => {
		expect(
			validateTransaction({
				...checkIncome,
				checkDetails: { checkNumber: ' ', checkDate: '2026-10-11' }
			})
		).toBe('check-number')
		expect(
			validateTransaction({
				...checkIncome,
				checkDetails: { checkNumber: '101', checkDate: '2025-02-29' }
			})
		).toBe('check-date')
	})

	it('rejects out-of-range amounts, dates, and missing import IDs', () => {
		expect(
			validateTransaction({ ...checkIncome, money: { amountMinor: -1, currency: 'USD' } })
		).toBe('amount')
		expect(validateTransaction({ ...checkIncome, bookedOn: '2026-02-29' })).toBe('booked-on')
		const importedIncome = {
			money: checkIncome.money,
			accountId: checkIncome.accountId,
			organizationId: checkIncome.organizationId,
			categoryId: checkIncome.categoryId,
			bookedOn: checkIncome.bookedOn,
			kind: 'income' as const,
			source: { source: 'simplefin' as const, externalId: ' ' }
		}
		expect(validateTransaction(importedIncome)).toBe('source-id')
	})
})
