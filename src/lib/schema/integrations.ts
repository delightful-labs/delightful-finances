import { schema as s } from 'jazz-tools'

export const integrationsSchema = {
	simplefinConnections: s.table(
		{
			organizationId: s.uuid(),
			accessUrl: s.string(),
			status: s.enum('active', 'error', 'revoked'),
			lastSyncAt: s.timestamp().optional(),
			lastError: s.string().optional(),
			claimedAt: s.timestamp()
		},
		{ organization: s.rel('organizations', 'organizationId') }
	),
	simplefinAccountLinks: s.table(
		{
			organizationId: s.uuid(),
			accountId: s.uuid(),
			simplefinAccountId: s.string(),
			simplefinOrgId: s.string().optional()
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			account: s.rel('accounts', 'accountId')
		}
	)
}
