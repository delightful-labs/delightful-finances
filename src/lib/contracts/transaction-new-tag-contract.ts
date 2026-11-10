import { z } from 'zod'
import { nativeTextReferenceSchema } from './native-text-transfer.js'
export const newTagPatchSchema = z.discriminatedUnion('type', [
	z.strictObject({
		type: z.literal('ADD'),
		name: z.union([z.string().max(4096), nativeTextReferenceSchema])
	}),
	z.strictObject({ type: z.literal('SELECT'), tagId: z.uuid() }),
	z.strictObject({ type: z.literal('REMOVE'), id: z.number().int().nonnegative().safe() })
])
export type NewTagPatch = z.infer<typeof newTagPatchSchema>
