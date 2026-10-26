import { describe, expect, it } from 'vitest'
import { formatMoney, formatSignedMoney, parseAmountMinor } from './money.js'

describe('parseAmountMinor', () => {
	it.each([
		['0', 0],
		['12', 1200],
		['12.3', 1230],
		['12.34', 1234],
		['21474836.48', 2_147_483_648],
		['90071992547409.90', 9_007_199_254_740_990],
		['90071992547409.91', Number.MAX_SAFE_INTEGER]
	])('parses %s to integer minor units', (input, expected) => {
		expect(parseAmountMinor(input)).toEqual({ kind: 'valid', amountMinor: expected })
	})

	it.each([
		'',
		'-1',
		'1.234',
		'01.00',
		'1e2',
		'90071992547409.92',
		'90071992547409.93',
		'90071992547410',
		'999999999999999999999999999999999999.99'
	])('rejects invalid amount %s', (input) => {
		expect(parseAmountMinor(input).kind).toBe('invalid')
	})
})

describe('formatMoney', () => {
	it.each([
		['en-US', 'USD', 123456, '$1,234.56'],
		['de-DE', 'EUR', 123456, '1.234,56\u00a0€'],
		['fr-FR', 'USD', 123456, '1\u202f234,56\u00a0$US'],
		['en-US', 'JPY', 1234, '¥1,234'],
		['en-US', 'KWD', 1234, 'KWD\u00a01.234'],
		[
			'ar-EG',
			'USD',
			123456,
			new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'USD' }).format(1234.56)
		]
	])('formats %s / %s using the currency fraction digits', (locale, currency, amount, expected) => {
		expect(formatMoney(amount, currency, locale)).toBe(expected)
	})

	it('formats minor units as locale-aware currency', () => {
		expect(formatMoney(1234, 'USD')).toBe('$12.34')
	})

	it('rejects negative or fractional minor units', () => {
		expect(() => formatMoney(-1, 'USD')).toThrow(RangeError)
		expect(() => formatMoney(1.5, 'USD')).toThrow(RangeError)
	})
})

describe('formatSignedMoney', () => {
	it.each([
		[123456n, 'en-US', 'USD', '$1,234.56'],
		[-1234n, 'en-US', 'USD', '-$12.34'],
		[-1n, 'en-US', 'USD', '-$0.01'],
		[1234n, 'en-US', 'JPY', '¥1,234']
	] as const)('formats %s minor units for %s / %s', (amount, locale, currency, expected) => {
		expect(formatSignedMoney(amount, currency, locale)).toBe(expected)
	})
})
