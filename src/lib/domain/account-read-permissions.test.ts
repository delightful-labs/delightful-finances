import { expect, it } from 'vitest'
import type { OrganizationMember } from '../schema.js'
import { canReadAccount, canWriteAccount } from './organization-permissions.js'
function membership(
	role: OrganizationMember['role'],
	accountAccessMode: OrganizationMember['accountAccessMode']
): OrganizationMember {
	return {
		id: 'member',
		organizationId: 'workspace',
		userId: 'user',
		profileId: null,
		role,
		accountAccessMode
	}
}
it.each<OrganizationMember['role']>(['owner', 'admin', 'member', 'viewer'])(
	'reads all accounts with the matching %s membership',
	(role) => {
		expect(canReadAccount(membership(role, 'all'), 'workspace', 'account', [])).toBe(true)
		expect(canReadAccount(membership(role, 'all'), 'other', 'account', [])).toBe(false)
	}
)
it.each<OrganizationMember['role']>(['member', 'viewer'])(
	'requires a matching read grant for selected-account %s access',
	(role) => {
		const member = membership(role, 'selected')
		expect(canReadAccount(member, 'workspace', 'account', [])).toBe(false)
		expect(
			canReadAccount(member, 'workspace', 'account', [{ accountId: 'other', access: 'read' }])
		).toBe(false)
		expect(
			canReadAccount(member, 'workspace', 'account', [{ accountId: 'account', access: 'read' }])
		).toBe(true)
		expect(
			canWriteAccount(member, 'workspace', 'account', [{ accountId: 'account', access: 'read' }])
		).toBe(false)
	}
)
it('denies missing membership even if stale grants remain', () => {
	expect(
		canReadAccount(null, 'workspace', 'account', [{ accountId: 'account', access: 'write' }])
	).toBe(false)
})
