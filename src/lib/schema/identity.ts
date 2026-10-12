import { schema as s } from 'jazz-tools'

export const identitySchema = {
	profiles: s.table(
		{
			userId: s.uuid(),
			displayName: s.string().optional()
		},
		{}
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
			role: s.enum('owner', 'admin', 'member', 'viewer'),
			accountAccessMode: s.enum('all', 'selected')
		},
		{ organization: s.rel('organizations', 'organizationId') }
	)
}
