import { z } from 'zod'

export const workspaceNameFormSchema = z.object({ name: z.string().trim().min(1) })

export const appProfileSchema = z.strictObject({
	userId: z.uuid(),
	displayName: z.string().trim().min(1).nullable().optional()
})

export const profileNameFormSchema = appProfileSchema
	.pick({ displayName: true })
	.extend({
		displayName: z
			.string()
			.trim()
			.transform((value) => value || null)
			.pipe(appProfileSchema.shape.displayName.unwrap())
	})
	.strip()
