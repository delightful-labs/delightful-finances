import { stableUuid } from './stable-uuid.js'
import { workspaceStarterCategories } from './workspace-defaults.js'
import { workspaceCreationAttemptSchema } from '../validation/identity.js'

/** Only required definitions; optional starters are never part of integrity repair. */
export async function prepareWorkspaceSystemCategories(organizationId: string) {
	const categories = await Promise.all(
		workspaceStarterCategories()
			.filter((category) => category.isSystem)
			.map(async ({ key, ...category }) => ({
				...category,
				id: await stableUuid(organizationId, `category:${category.kind}:${key}`)
			}))
	)
	return workspaceCreationAttemptSchema.shape.categories.parse(categories)
}
