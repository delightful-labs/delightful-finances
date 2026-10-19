import { schema as s } from 'jazz-tools'

export const tagsSchema = {
	tags: s.table(
		{
			organizationId: s.uuid(),
			name: s.string(),
			// Nullable only for legacy tags awaiting an explicit kind migration.
			kind: s.enum('expense', 'income').optional(),
			categoryId: s.uuid().optional(),
			archivedAt: s.timestamp().optional()
		},
		{
			organization: s.rel('organizations', 'organizationId'),
			category: s.rel('categories', 'categoryId'),
			transactionTags: s.reverse('transactionTags', 'tag')
		}
	)
}
