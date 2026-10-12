import { describe, expect, it } from 'vitest'
import { formatMoney, parseAmountMinor } from './money.js'

describe('parseAmountMinor', () => {
	it.each([
		['0', 0],
		['12', 1200],
		['12.3', 1230],
		['12.34', 1234]
	])('parses %s to integer minor units', (input, expected) => {
		expect(parseAmountMinor(input)).toEqual({ kind: 'valid', amountMinor: expected })
	})

	it.each(['', '-1', '1.234', '01.00', '1e2', '21474836.48'])(
		'rejects invalid amount %s',
		(input) => {
			expect(parseAmountMinor(input).kind).toBe('invalid')
		}
	)
})

describe('formatMoney', () => {
	it('formats minor units as locale-aware currency', () => {
		expect(formatMoney(1234, 'USD')).toBe('$12.34')
	})

	it('rejects negative or fractional minor units', () => {
		expect(() => formatMoney(-1, 'USD')).toThrow(RangeError)
		expect(() => formatMoney(1.5, 'USD')).toThrow(RangeError)
	})
})
