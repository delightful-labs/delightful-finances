import { describe, expect, it } from 'vitest'
import { accountFormSchema } from './account-form-input.js'

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
