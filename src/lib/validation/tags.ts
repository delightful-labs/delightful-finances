import { z } from 'zod'

export const appTagSchema = z.strictObject({
	organizationId: z.uuid(),
	name: z.string().trim().min(1),
	categoryId: z.uuid().nullable().default(null),
	archivedAt: z.date().nullable().default(null)
})

export const tagFormSchema = appTagSchema
	.pick({ name: true, categoryId: true })
	.extend({
		categoryId: z.union([z.literal('').transform(() => null), appTagSchema.shape.categoryId])
	})
	.strip()
