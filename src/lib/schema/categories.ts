import { schema as s } from 'jazz-tools'

export const categoriesSchema = {
	categories: s.table(
		{
			organizationId: s.uuid(),
			name: s.string(),
			kind: s.enum('expense', 'income'),
			isSystem: s.boolean(),
			archivedAt: s.timestamp().optional()
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			transactions: s.reverse('transactions', 'category'),
			tags: s.reverse('tags', 'category')
		}
	)
}
