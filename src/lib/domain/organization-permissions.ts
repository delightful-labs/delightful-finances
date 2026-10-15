import type { OrganizationMember } from '../schema.js'

export function canEditCategoriesAndTags(
	membership: OrganizationMember | null | undefined,
	organizationId: string | null
): boolean {
	return (
		membership?.organizationId === organizationId &&
		(membership.role === 'owner' || membership.role === 'admin' || membership.role === 'member')
	)
}
