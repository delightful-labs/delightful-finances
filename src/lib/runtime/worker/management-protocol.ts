import { nativeTextReferenceSchema } from '../../contracts/native-text-transfer.js'
import { z } from 'zod'
import { createFormViewSchema, projectFormView } from './form-protocol.js'
import type { ManagementView } from '../../contracts/management-contract.js'
import type { Category, Tag } from '../../schema.js'

const id = z.string().uuid()
export const categoryRowSchema = z
	.object({
		id,
		organizationId: id,
		name: z.string().max(4096),
		kind: z.enum(['income', 'expense']),
		isSystem: z.boolean(),
		archivedAt: z.date().nullable()
	})
	.strict()
export const tagRowSchema = z
	.object({
		id,
		organizationId: id,
		name: z.string().max(4096),
		kind: z.enum(['income', 'expense']),
		categoryId: id.nullable(),
		archivedAt: z.date().nullable()
	})
	.strict()
const reason = z.enum([
	'sessionUnavailable',
	'selectWorkspace',
	'loading',
	'loadFailed',
	'readOnly',
	'unavailableReference',
	'protectedRecord',
	'duplicateName'
])
const categoryFormSchema = createFormViewSchema(categoryRowSchema, reason)
const tagFormSchema = createFormViewSchema(tagRowSchema, reason)
const archiveFormSchema = createFormViewSchema(z.string().max(4096), reason)
export const managementFormsSchema = z
	.object({
		category: categoryFormSchema,
		tag: tagFormSchema,
		categoryArchive: archiveFormSchema,
		tagArchive: archiveFormSchema
	})
	.strict()
export const managementCommandSchema = z
	.object({
		form: z.enum(['category', 'tag', 'categoryArchive', 'tagArchive']),
		command: z.discriminatedUnion('type', [
			z.object({ type: z.enum(['OPEN', 'RESET', 'CANCEL', 'RETRY_READINESS']) }).strict(),
			z
				.object({
					type: z.enum(['SUBMIT', 'CHANGE']),
					values: z
						.object({
							name: z.union([z.string().max(4096), nativeTextReferenceSchema]).optional(),
							kind: z.string().max(64).optional(),
							categoryId: z.string().max(64).nullable().optional(),
							tagId: z.string().max(64).optional(),
							organizationId: z.string().max(64).optional()
						})
						.strict()
				})
				.strict()
		])
	})
	.strict()
export const MANAGEMENT_PAGE_SIZE = 500
const page = z
	.object({
		offset: z.number().int().nonnegative(),
		total: z.number().int().nonnegative(),
		hasMore: z.boolean()
	})
	.strict()
export const managementViewSchema = z
	.object({
		categoryFilter: z.enum(['active', 'archived', 'all']),
		tagFilter: z.enum(['active', 'archived', 'all']),
		tagRecordCount: z.number().int().nonnegative(),
		categoryOptionsKind: z.enum(['expense', 'income']),
		categoryOptions: z.array(categoryRowSchema).max(MANAGEMENT_PAGE_SIZE),
		categoryOptionsPage: page,
		forms: managementFormsSchema,
		categories: z
			.array(
				categoryRowSchema
					.extend({
						transactionCount: z.number().int().nonnegative(),
						tagCount: z.number().int().nonnegative(),
						archivable: z.boolean()
					})
					.strict()
			)
			.max(MANAGEMENT_PAGE_SIZE),
		tags: z
			.array(
				tagRowSchema
					.extend({ categoryName: z.string().max(4096).nullable(), archivable: z.boolean() })
					.strict()
			)
			.max(MANAGEMENT_PAGE_SIZE),
		categoryPage: page,
		tagPage: page,
		loading: z.boolean(),
		failed: z.boolean(),
		tagLoading: z.boolean(),
		tagFailed: z.boolean()
	})
	.strict()
export type ManagementIntent = z.infer<typeof managementCommandSchema>
export type PublicManagementView = z.infer<typeof managementViewSchema>
export function publicCategory(row: Category) {
	const { id, organizationId, name, kind, isSystem, archivedAt } = row
	return { id, organizationId, name: name.slice(0, 4096), kind, isSystem, archivedAt }
}
export function publicTag(row: Tag) {
	const { id, organizationId, name, kind, categoryId, archivedAt } = row
	return { id, organizationId, name: name.slice(0, 4096), kind, categoryId, archivedAt }
}
export function projectManagementForms(
	views:
		| {
				category: ManagementView<Category> | undefined
				tag: ManagementView<Tag> | undefined
				categoryArchive: ManagementView<string> | undefined
				tagArchive: ManagementView<string> | undefined
		  }
		| undefined
) {
	return {
		category: categoryFormSchema.parse(projectFormView(views?.category, publicCategory)),
		tag: tagFormSchema.parse(projectFormView(views?.tag, publicTag)),
		categoryArchive: archiveFormSchema.parse(
			projectFormView(views?.categoryArchive, (name) => name.slice(0, 4096))
		),
		tagArchive: archiveFormSchema.parse(
			projectFormView(views?.tagArchive, (name) => name.slice(0, 4096))
		)
	}
}
export function emptyManagementView(): PublicManagementView {
	return {
		categoryFilter: 'active',
		tagFilter: 'active',
		tagRecordCount: 0,
		categoryOptionsKind: 'expense',
		categoryOptions: [],
		categoryOptionsPage: { offset: 0, total: 0, hasMore: false },
		forms: projectManagementForms(undefined),
		categories: [],
		tags: [],
		categoryPage: { offset: 0, total: 0, hasMore: false },
		tagPage: { offset: 0, total: 0, hasMore: false },
		loading: true,
		failed: false,
		tagLoading: true,
		tagFailed: false
	}
}
