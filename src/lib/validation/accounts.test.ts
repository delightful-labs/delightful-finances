import { describe, expect, it } from 'vitest'
import { accountFormSchema, appAccountSchema } from './accounts.js'

describe('canonical account schema', () => {
	const input = {
		organizationId: '11111111-1111-4111-8111-111111111111',
		name: '  Checking  ',
		kind: 'bank'
	}
	it('normalizes names and supplies currency and active-state defaults', () => {
		expect(appAccountSchema.parse(input)).toEqual({
			...input,
			name: 'Checking',
			currency: 'USD',
			archivedAt: null
		})
	})
	it('preserves an explicit supported currency and archive date', () => {
		const archivedAt = new Date()
		expect(appAccountSchema.parse({ ...input, currency: 'EUR', archivedAt })).toMatchObject({
			currency: 'EUR',
			archivedAt
		})
	})
	it.each([
		{ organizationId: 'invalid' },
		{ name: ' ' },
		{ kind: 'investment' },
		{ currency: 'usd' },
		{ currency: 'ZZZ' },
		{ archivedAt: '2026-10-13' }
	])('rejects invalid entity fields %j', (values) => {
		expect(appAccountSchema.safeParse({ ...input, ...values }).success).toBe(false)
	})
})

describe('account form schema', () => {
	it.each(['cash', 'bank', 'card'])('trims the name and accepts %s accounts', (kind) => {
		expect(accountFormSchema.parse({ name: '  Checking  ', kind })).toEqual({
			name: 'Checking',
			kind
		})
	})
	it.each(['', ' ', '\t\n'])('rejects a blank name %j', (name) => {
		expect(accountFormSchema.safeParse({ name, kind: 'bank' }).success).toBe(false)
	})
	it.each(['', 'investment', null, undefined])('rejects an invalid type %j', (kind) => {
		expect(accountFormSchema.safeParse({ name: 'Checking', kind }).success).toBe(false)
	})
	it('ignores submitted workspace and currency fields', () => {
		expect(
			accountFormSchema.parse({
				name: 'Checking',
				kind: 'bank',
				organizationId: 'other',
				currency: 'EUR'
			})
		).toEqual({ name: 'Checking', kind: 'bank' })
	})
})
