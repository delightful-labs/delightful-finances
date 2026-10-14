import { describe, expect, it } from 'vitest'
import { appProfileSchema, profileNameFormSchema, workspaceNameFormSchema } from './identity.js'

describe('workspace name validation', () => {
	it('trims the submitted name', () => {
		expect(workspaceNameFormSchema.parse({ name: '  Household  ' })).toEqual({ name: 'Household' })
	})
	it.each(['', ' ', '\t\n', undefined, null, 123])('rejects invalid names %j', (name) => {
		expect(workspaceNameFormSchema.safeParse({ name }).success).toBe(false)
	})
	it('strips fields outside the name form', () => {
		expect(workspaceNameFormSchema.parse({ name: 'Household', ownerId: 'other' })).toEqual({
			name: 'Household'
		})
	})
})

describe('profile name validation', () => {
	const userId = '11111111-1111-4111-8111-111111111111'
	it('trims names in the canonical schema and form', () => {
		expect(appProfileSchema.parse({ userId, displayName: '  Matthew  ' })).toEqual({
			userId,
			displayName: 'Matthew'
		})
		expect(profileNameFormSchema.parse({ displayName: '  Matthew  ' })).toEqual({
			displayName: 'Matthew'
		})
	})
	it.each(['', ' ', '\t\n'])('clears a blank submitted name %j', (displayName) => {
		expect(profileNameFormSchema.parse({ displayName })).toEqual({ displayName: null })
	})
	it('allows missing or cleared canonical names for identity fallbacks', () => {
		expect(appProfileSchema.parse({ userId })).toEqual({ userId })
		expect(appProfileSchema.parse({ userId, displayName: null })).toEqual({
			userId,
			displayName: null
		})
	})
	it.each([undefined, null, 123, {}, ['Matthew']])(
		'rejects non-text form values %j',
		(displayName) => {
			expect(profileNameFormSchema.safeParse({ displayName }).success).toBe(false)
		}
	)
	it('strips submitted identity and profile ID fields', () => {
		expect(
			profileNameFormSchema.parse({ displayName: 'Matthew', userId: 'other', id: 'other' })
		).toEqual({ displayName: 'Matthew' })
	})
	it('rejects invalid canonical identity and blank canonical names', () => {
		expect(appProfileSchema.safeParse({ userId: 'invalid', displayName: 'Matthew' }).success).toBe(
			false
		)
		expect(appProfileSchema.safeParse({ userId, displayName: ' ' }).success).toBe(false)
	})
})
