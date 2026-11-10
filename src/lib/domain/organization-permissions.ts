import { ACCOUNT_ACCESS } from '#lib/domain/account-access.js'
import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
import type { OrganizationMember } from '../schema.js'

export function canManageBankCredentials(
	membership: OrganizationMember | null | undefined,
	organizationId: string
): boolean {
	return (
		membership?.organizationId === organizationId &&
		(membership.role === ORGANIZATION_ROLE.OWNER || membership.role === ORGANIZATION_ROLE.ADMIN)
	)
}

/** Matches the account read policy in permissions.ts; a read grant never
 * authorizes a write. Native full-text reads recheck this against fresh facts. */
export function canReadAccount(
	membership: OrganizationMember | null | undefined,
	organizationId: string | null,
	accountId: string,
	grants: readonly { accountId: string; access: 'read' | 'write' }[]
): boolean {
	if (!membership || membership.organizationId !== organizationId) return false
	return (
		membership.role === ORGANIZATION_ROLE.OWNER ||
		membership.role === ORGANIZATION_ROLE.ADMIN ||
		((membership.role === ORGANIZATION_ROLE.MEMBER ||
			membership.role === ORGANIZATION_ROLE.VIEWER) &&
			membership.accountAccessMode === ACCOUNT_ACCESS.ALL) ||
		grants.some((grant) => grant.accountId === accountId)
	)
}

export function canWriteAccount(
	membership: OrganizationMember | null | undefined,
	organizationId: string | null,
	accountId: string,
	grants: readonly { accountId: string; access: 'read' | 'write' }[]
): boolean {
	if (membership?.organizationId !== organizationId) return false
	if (membership.role === ORGANIZATION_ROLE.OWNER || membership.role === ORGANIZATION_ROLE.ADMIN)
		return true
	return (
		membership.role === ORGANIZATION_ROLE.MEMBER &&
		(membership.accountAccessMode === ACCOUNT_ACCESS.ALL ||
			(membership.accountAccessMode === ACCOUNT_ACCESS.SELECTED &&
				grants.some((grant) => grant.accountId === accountId && grant.access === 'write')))
	)
}

export function canDeleteAccount(
	membership: OrganizationMember | null | undefined,
	organizationId: string | null,
	accountId: string,
	grants: readonly { accountId: string; canDelete: boolean }[]
): boolean {
	if (membership?.organizationId !== organizationId) return false
	if (membership.role === ORGANIZATION_ROLE.OWNER || membership.role === ORGANIZATION_ROLE.ADMIN)
		return true
	return (
		membership.role === ORGANIZATION_ROLE.MEMBER &&
		grants.some((grant) => grant.accountId === accountId && grant.canDelete)
	)
}

export function canEditCategoriesAndTags(
	membership: OrganizationMember | null | undefined,
	organizationId: string | null
): boolean {
	return (
		membership?.organizationId === organizationId &&
		(membership.role === ORGANIZATION_ROLE.OWNER ||
			membership.role === ORGANIZATION_ROLE.ADMIN ||
			membership.role === ORGANIZATION_ROLE.MEMBER)
	)
}
