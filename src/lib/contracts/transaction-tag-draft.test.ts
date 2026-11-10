import { expect, it } from 'vitest'
import { mergeTransactionTagDraft } from './transaction-tag-draft.js'

it('preserves selections outside a bounded page and unabridged legacy names', () => {
	const tags = Array.from({ length: 1001 }, (_, index) => ({
		id: crypto.randomUUID(),
		name: index === 1000 ? 'Legacy '.repeat(1000) : `Tag ${index}`
	}))
	const result = mergeTransactionTagDraft(
		{ tagMode: 'append', amount: '2.34', tags: ['Added'] },
		tags,
		new Set()
	)
	expect(result.kind).toBe('valid')
	if (result.kind !== 'valid') throw new Error('Expected a merged draft')
	expect(result.values).toEqual({ amount: '2.34', tags: [...tags.map((tag) => tag.name), 'Added'] })
})
it('retains ID-based removals across pages and restores the original name', () => {
	const first = { id: crypto.randomUUID(), name: 'First' },
		last = { id: crypto.randomUUID(), name: 'Last '.repeat(1000) }
	const tags = [first, last],
		original = new Set<string>()
	const removed = mergeTransactionTagDraft(
		{ tagMode: 'append', tagEdit: { id: last.id, selected: false }, tags: [] },
		tags,
		original
	)
	if (removed.kind !== 'valid') throw new Error('Expected a merged draft')
	expect(original.size).toBe(0)
	expect(removed.values).toEqual({ tags: ['First'] })
	const restored = mergeTransactionTagDraft(
		{ tagMode: 'append', tagEdit: { id: last.id, selected: true }, tags: ['Added'] },
		tags,
		removed.removedTagIds
	)
	if (restored.kind !== 'valid') throw new Error('Expected a merged draft')
	expect(restored.values).toEqual({ tags: ['First', last.name, 'Added'] })
	expect(removed.removedTagIds.has(last.id)).toBe(true)
})
it('rejects malformed patches without changing the draft and preserves complete legacy intents', () => {
	const removed = new Set<string>()
	expect(
		mergeTransactionTagDraft(
			{ tagMode: 'append', tagEdit: { id: 'invalid', selected: false }, tags: [] },
			[],
			removed
		)
	).toEqual({ kind: 'invalid' })
	const values = { tags: ['Full selection'] }
	expect(mergeTransactionTagDraft(values, [], removed)).toEqual({
		kind: 'valid',
		values,
		removedTagIds: removed
	})
})
