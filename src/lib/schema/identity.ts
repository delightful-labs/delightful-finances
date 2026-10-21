import { schema as s } from 'jazz-tools'
import { avatarMimeType } from '../validation/identity.js'

const avatarTypes = avatarMimeType.enum

export const identitySchema = {
	profiles: s.table(
		{
			userId: s.uuid(),
			// Initialization provenance only; never active-workspace selection or authority.
			initialWorkspaceId: s.uuid().optional(),
			displayName: s.string().optional(),
			avatarData: s.bytes().optional(),
			avatarMimeType: s
				.enum(avatarTypes['image/png'], avatarTypes['image/jpeg'], avatarTypes['image/webp'])
				.optional()
		},
		{ memberships: s.reverse('organizationMembers', 'profile') }
	),
	organizations: s.table(
		{
			name: s.string(),
			kind: s.enum('personal', 'business'),
			defaultCurrency: s.string(),
			ownerId: s.uuid()
		},
		{
			members: s.reverse('organizationMembers', 'organization'),
			accounts: s.reverse('accounts', 'organization'),
			categories: s.reverse('categories', 'organization'),
			tags: s.reverse('tags', 'organization'),
			transactions: s.reverse('transactions', 'organization'),
			simplefinConnections: s.reverse('simplefinConnections', 'organization'),
			batches: s.reverse('transactionBatches', 'organization'),
			batchTemplates: s.reverse('batchTemplates', 'organization')
		}
	),
	organizationMembers: s.table(
		{
			organizationId: s.uuid(),
			userId: s.uuid(),
			profileId: s.uuid().optional(),
			role: s.enum('owner', 'admin', 'member', 'viewer'),
			accountAccessMode: s.enum('all', 'selected')
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			profile: s.rel('profiles', 'profileId')
		}
	)
}
