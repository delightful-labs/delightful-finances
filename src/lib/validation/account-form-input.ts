import { z } from 'zod'

export const accountFormSchema = z.object({
	name: z.string().trim().min(1),
	kind: z.enum(['cash', 'bank', 'card'])
})
