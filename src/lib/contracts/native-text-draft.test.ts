import { describe, expect, it } from 'vitest'
import { resolveNativeTextDraft } from './native-text-draft.js'
const reference = {
	kind: 'text',
	textScope: 'test',
	reference: '550e8400-e29b-41d4-a716-446655440000',
	version: 1
}
describe('native text draft resolution', () => {
	it('resolves private full strings without mutating the submitted draft', () => {
		const values = { memo: reference, description: 'short', amount: '1.23' }
		const result = resolveNativeTextDraft(values, ['memo', 'description'], (field) =>
			field === 'memo' ? 'x'.repeat(20000) : undefined
		)
		expect(result).toEqual({ kind: 'valid', values: { ...values, memo: 'x'.repeat(20000) } })
		expect(values.memo).toBe(reference)
	})
	it('rejects a partially resolved draft if another reference is stale or belongs to another field', () => {
		expect(
			resolveNativeTextDraft(
				{ description: reference, memo: reference },
				['description', 'memo'],
				(field) => (field === 'description' ? 'resolved' : undefined)
			)
		).toEqual({ kind: 'invalid' })
	})
	it.each([
		null,
		[],
		{ memo: { ...reference, version: 0 } },
		{ memo: { ...reference, unexpected: true } }
	])('rejects malformed input %j', (values) => {
		expect(resolveNativeTextDraft(values, ['memo'], () => 'value')).toEqual({ kind: 'invalid' })
	})
})
