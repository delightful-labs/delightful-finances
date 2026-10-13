import { z } from 'zod'

export const appCategorySchema = z.strictObject({
	organizationId: z.uuid(),
	name: z.string().trim().min(1),
	kind: z.enum(['expense', 'income']),
	isSystem: z.boolean().default(false),
	archivedAt: z.date().nullable().default(null)
})

export const categoryFormSchema = appCategorySchema.pick({ name: true, kind: true }).strip()
