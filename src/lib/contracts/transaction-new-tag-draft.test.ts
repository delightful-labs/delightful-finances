import { expect, it } from 'vitest'
import {
	emptyNewTagDraft,
	mergeNewTagDraft,
	type NewTagDraft
} from './transaction-new-tag-draft.js'
import type { NewTagPatch } from './transaction-new-tag-contract.js'
const id = '550e8400-e29b-41d4-a716-446655440000'
function patch(
	draft: NewTagDraft,
	tagPatch: NewTagPatch,
	catalog: readonly { id: string; name: string }[] = [],
	saved: readonly string[] = []
) {
	return mergeNewTagDraft(
		{ tagComposer: true, tagPatch, amount: '1.23' },
		draft,
		catalog,
		saved,
		() => undefined
	)
}
it('keeps more than one thousand private tags and forwards their complete names to canonical validation', () => {
	let draft = emptyNewTagDraft()
	for (let index = 0; index < 1001; index++) {
		const next = patch(draft, { type: 'ADD', name: `Tag ${index}` })
		if (next.kind !== 'valid' || !next.accepted) throw new Error('Draft rejected a canonical tag')
		draft = next.draft
	}
	expect(draft.items).toHaveLength(1001)
	const result = mergeNewTagDraft(
		{ tagComposer: true, description: 'memo' },
		draft,
		[],
		[],
		() => undefined
	)
	expect(result).toEqual({
		kind: 'valid',
		accepted: true,
		draft,
		values: {
			description: 'memo',
			tags: Array.from({ length: 1001 }, (_, index) => `Tag ${index}`)
		}
	})
})
it('selects a full long catalog name by ID and resolves a new long native name without using its preview', () => {
	const name = 'long name '.repeat(700)
	const first = patch(emptyNewTagDraft(), { type: 'SELECT', tagId: id }, [{ id, name }])
	if (first.kind !== 'valid') throw new Error('Missing selected draft')
	expect(first.draft.items[0]?.name).toBe(name.trim())
	const reference = {
		kind: 'text',
		reference: id,
		textScope: 'scope',
		version: 1
	} satisfies import('./native-text-transfer.js').NativeTextReference
	const second = mergeNewTagDraft(
		{ tagComposer: true, tagPatch: { type: 'ADD', name: reference } },
		first.draft,
		[],
		[],
		() => 'Another '.repeat(800)
	)
	if (second.kind !== 'valid') throw new Error('Missing native draft')
	expect(second.accepted).toBe(true)
	expect(second.draft.items[1]?.name).toBe('Another '.repeat(800).trim())
})
it('reports canonical empty and duplicate names without changing the selection or accepting submit', () => {
	const original = patch(emptyNewTagDraft(), { type: 'ADD', name: '  Travel  ' })
	if (original.kind !== 'valid') throw new Error('Missing initial draft')
	const duplicate = patch(original.draft, { type: 'ADD', name: ' travel ' })
	expect(duplicate.kind === 'valid' && duplicate.accepted).toBe(false)
	expect(duplicate.kind === 'valid' && duplicate.draft.items).toEqual([{ id: 0, name: 'Travel' }])
	const saved = patch(emptyNewTagDraft(), { type: 'ADD', name: 'travel' }, [], ['Travel'])
	expect(saved.kind === 'valid' && saved.draft.feedback?.kind).toBe('duplicate')
	const blank = patch(original.draft, { type: 'ADD', name: '  ' })
	expect(blank.kind === 'valid' && blank.draft.feedback?.kind).toBe('empty')
})
it('removes by stable identity and does not recycle identities after reset', () => {
	const first = patch(emptyNewTagDraft(), { type: 'ADD', name: 'First' })
	if (first.kind !== 'valid') throw new Error('Missing first')
	const next = patch(emptyNewTagDraft(first.draft.nextId), { type: 'ADD', name: 'Second' })
	if (next.kind !== 'valid') throw new Error('Missing next')
	const stale = patch(next.draft, { type: 'REMOVE', id: 0 })
	expect(stale.kind === 'valid' && stale.draft.items).toEqual([{ id: 1, name: 'Second' }])
	const removed = patch(next.draft, { type: 'REMOVE', id: 1 })
	expect(removed.kind === 'valid' && removed.draft.items).toEqual([])
})
it('rejects unavailable IDs/references and ambiguous raw arrays without accepting a financial submission', () => {
	const absent = patch(emptyNewTagDraft(), { type: 'SELECT', tagId: id })
	expect(absent.kind === 'valid' && absent.accepted).toBe(false)
	const reference = { kind: 'text', reference: id, textScope: 'scope', version: 1 }
	const stale = mergeNewTagDraft(
		{ tagComposer: true, tagPatch: { type: 'ADD', name: reference } },
		emptyNewTagDraft(),
		[],
		[],
		() => undefined
	)
	expect(stale.kind === 'valid' && stale.accepted).toBe(false)
	expect(
		mergeNewTagDraft(
			{ tagComposer: true, tags: ['ambiguous'] },
			emptyNewTagDraft(),
			[],
			[],
			() => undefined
		)
	).toEqual({ kind: 'invalid' })
})
