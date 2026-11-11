import { createManagementFormOptions } from './management.js'
import type { ManagementObservation } from '../../contracts/management-contract.js'
import { createCategory, createTag, archiveCategory, archiveTag } from '../../data.js'
import { categoryFormSchema, categoryArchiveSchema } from '../../validation/categories.js'
import { tagFormSchema, tagArchiveSchema } from '../../validation/tags.js'

/** Composition of existing policy and persistence leaves, shared by worker forms. */
export function createClassificationFormOptions(
	db: Parameters<typeof createCategory>[0] & Parameters<typeof archiveCategory>[0],
	observe: (kind: 'category' | 'tag') => ManagementObservation
) {
	const categoryOptions = createManagementFormOptions({
		binding: db,
		observe: () => observe('category')
	})
	const tagOptions = createManagementFormOptions({ binding: db, observe: () => observe('tag') })
	return {
		category: categoryOptions({
			schema: categoryFormSchema,
			successContent: 'replace',
			assessmentObservation: ({ request, observation }) => ({
				...observation.facts,
				intent: {
					kind: 'createCategory',
					name: request.values.name,
					categoryKind: request.values.kind
				}
			}),
			write: ({ request }) => {
				if (!request.scope.organizationId) throw new Error('Missing authorized workspace')
				return createCategory(
					db,
					request.scope.organizationId,
					request.values.name,
					request.values.kind
				)
			}
		}),
		tag: tagOptions({
			schema: tagFormSchema,
			successContent: 'replace',
			assessmentObservation: ({ request, observation }) => ({
				...observation.facts,
				intent: {
					kind: 'createTag',
					name: request.values.name,
					tagKind: request.values.kind,
					categoryId: request.values.categoryId
				}
			}),
			write: ({ request }) => {
				if (!request.scope.organizationId) throw new Error('Missing authorized workspace')
				return createTag(
					db,
					request.scope.organizationId,
					request.values.name,
					request.values.kind,
					request.values.categoryId
				)
			}
		}),
		categoryArchive: categoryOptions({
			schema: categoryArchiveSchema,
			successContent: 'retain',
			assessmentObservation: ({ request, observation }) => ({
				...observation.facts,
				intent: {
					kind: 'archiveCategory',
					id: request.values.categoryId,
					organizationId: request.values.organizationId
				}
			}),
			write: ({ request, observation }) =>
				archiveCategory(db, request.values.categoryId).then(
					() =>
						observation.facts.categories.find((row) => row.id === request.values.categoryId)
							?.name ?? request.values.categoryId
				)
		}),
		tagArchive: tagOptions({
			schema: tagArchiveSchema,
			successContent: 'retain',
			assessmentObservation: ({ request, observation }) => ({
				...observation.facts,
				intent: {
					kind: 'archiveTag',
					id: request.values.tagId,
					organizationId: request.values.organizationId
				}
			}),
			write: ({ request, observation }) =>
				archiveTag(db, request.values.tagId).then(
					() =>
						observation.facts.tags.find((row) => row.id === request.values.tagId)?.name ??
						request.values.tagId
				)
		})
	}
}
