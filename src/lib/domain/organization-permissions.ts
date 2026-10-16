import type { OrganizationMember } from '../schema.js'

export function canManageBankCredentials(
	membership: OrganizationMember | null | undefined,
	organizationId: string
): boolean {
	return (
		membership?.organizationId === organizationId &&
		(membership.role === 'owner' || membership.role === 'admin')
	)
}

export function canWriteAccount(
	membership: OrganizationMember | null | undefined,
	organizationId: string | null,
	accountId: string,
	grants: readonly { accountId: string; access: 'read' | 'write' }[]
): boolean {
	if (membership?.organizationId !== organizationId) return false
	if (membership.role === 'owner' || membership.role === 'admin') return true
	return (
		membership.role === 'member' &&
		(membership.accountAccessMode === 'all' ||
			(membership.accountAccessMode === 'selected' &&
				grants.some((grant) => grant.accountId === accountId && grant.access === 'write')))
	)
}

export function canEditCategoriesAndTags(
	membership: OrganizationMember | null | undefined,
	organizationId: string | null
): boolean {
	return (
		membership?.organizationId === organizationId &&
		(membership.role === 'owner' || membership.role === 'admin' || membership.role === 'member')
	)
}
