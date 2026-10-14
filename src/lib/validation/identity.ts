import { z } from 'zod'

export const workspaceNameFormSchema = z.object({ name: z.string().trim().min(1) })
