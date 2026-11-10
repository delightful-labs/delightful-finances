import { newTagPatchSchema } from './transaction-new-tag-contract.js'
import { z } from 'zod'
import type { NativeTextReference } from './native-text-transfer.js'
import { tagFormSchema } from '../validation/tags.js'
import { normalizedName } from '../domain/names.js'
export type NewTagDraft = {
	items: readonly { id: number; name: string }[]
	nextId: number
	offset: number
	feedback: { kind: 'duplicate'; name: string } | { kind: 'empty' | 'unavailable' } | null
}
export function emptyNewTagDraft(nextId = 0): NewTagDraft {
	return { items: [], nextId, offset: 0, feedback: null }
}
const draftSchema = z
	.object({ tagComposer: z.literal(true), tagPatch: newTagPatchSchema.optional() })
	.catchall(z.unknown())
/** Pure worker-owned draft transformation. Full strings never leave the worker
 * as ordinary views, and no SDK write follows from an accepted draft patch. */
export function mergeNewTagDraft(
	values: unknown,
	previous: NewTagDraft,
	catalog: readonly { id: string; name: string }[],
	selectedSaved: readonly string[],
	resolve: (reference: NativeTextReference) => string | undefined
): { kind: 'valid'; values: unknown; draft: NewTagDraft; accepted: boolean } | { kind: 'invalid' } {
	const marker = z.object({ tagComposer: z.unknown().optional() }).safeParse(values)
	if (!marker.success || marker.data.tagComposer === undefined)
		return { kind: 'valid', values, draft: previous, accepted: true }
	const parsed = draftSchema.safeParse(values)
	if (!parsed.success || parsed.data.tags !== undefined) return { kind: 'invalid' }
	const { tagComposer, tagPatch, ...raw } = parsed.data
	let draft = previous
	if (tagPatch?.type === 'REMOVE')
		draft = {
			...previous,
			items: previous.items.filter((item) => item.id !== tagPatch.id),
			feedback: null
		}
	if (tagPatch?.type === 'ADD' || tagPatch?.type === 'SELECT') {
		const name =
			tagPatch.type === 'SELECT'
				? catalog.find((tag) => tag.id === tagPatch.tagId)?.name
				: typeof tagPatch.name === 'string'
					? tagPatch.name
					: resolve(tagPatch.name)
		const checked = tagFormSchema.shape.name.safeParse(name)
		if (name === undefined) draft = { ...previous, feedback: { kind: 'unavailable' } }
		else if (!checked.success) draft = { ...previous, feedback: { kind: 'empty' } }
		else if (
			previous.items.some((item) => normalizedName(item.name) === normalizedName(checked.data)) ||
			selectedSaved.some((saved) => normalizedName(saved) === normalizedName(checked.data))
		)
			draft = { ...previous, feedback: { kind: 'duplicate', name: checked.data } }
		else if (previous.nextId >= Number.MAX_SAFE_INTEGER)
			draft = { ...previous, feedback: { kind: 'unavailable' } }
		else
			draft = {
				...previous,
				items: [...previous.items, { id: previous.nextId, name: checked.data }],
				nextId: previous.nextId + 1,
				feedback: null
			}
	}
	return { kind: 'valid', accepted: !tagPatch || draft.feedback === null, draft, values: { ...raw, tags: draft.items.map((item) => item.name) } }
}
