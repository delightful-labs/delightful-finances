import { z } from 'zod'

export type SavedTransactionTag = { id: string; name: string }
const patchSchema = z
	.object({
		tagMode: z.literal('append'),
		tags: z.array(z.string()).optional(),
		tagEdit: z.strictObject({ id: z.uuid(), selected: z.boolean() }).optional()
	})
	.catchall(z.unknown())

/** Existing tags stay private. Labels shown in a bounded page are never used
 * to reconstruct a saved selection, including legacy names longer than a cell. */
export function mergeTransactionTagDraft(
	values: unknown,
	existing: readonly SavedTransactionTag[],
	removedTagIds: ReadonlySet<string>
): { kind: 'valid'; values: unknown; removedTagIds: ReadonlySet<string> } | { kind: 'invalid' } {
	const marker = z.object({ tagMode: z.unknown().optional() }).safeParse(values)
	if (!marker.success || marker.data.tagMode !== 'append')
		return { kind: 'valid', values, removedTagIds }
	const parsed = patchSchema.safeParse(values)
	if (!parsed.success) return { kind: 'invalid' }
	const { tagMode, tagEdit, ...draft } = parsed.data
	const removed = new Set(removedTagIds)
	if (tagEdit && existing.some((tag) => tag.id === tagEdit.id)) {
		if (tagEdit.selected) removed.delete(tagEdit.id)
		else removed.add(tagEdit.id)
	}
	return {
		kind: 'valid',
		removedTagIds: removed,
		values: {
			...draft,
			tags: [
				...existing.filter((tag) => !removed.has(tag.id)).map((tag) => tag.name),
				...(draft.tags ?? [])
			]
		}
	}
}
