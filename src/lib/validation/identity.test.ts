import { describe, expect, it } from 'vitest'
import { workspaceNameFormSchema } from './identity.js'

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
