import { expect, it } from 'vitest'
import { mergeTransactionTextDraft } from './transaction-text-draft.js'

it('retains complete unchanged text instead of saving bounded previews', () => {
	const source = {
		description: 'Description '.repeat(1000),
		memo: 'Memo '.repeat(2000),
		check: { checkNumber: 'Number '.repeat(1000) }
	}
	const result = mergeTransactionTextDraft(
		{
			retainedFields: ['description', 'memo', 'checkNumber'],
			description: 'preview',
			memo: 'preview',
			checkNumber: 'preview',
			amount: '2.34'
		},
		source
	)
	expect(result).toEqual({
		kind: 'valid',
		values: {
			description: source.description,
			memo: source.memo,
			checkNumber: source.check.checkNumber,
			amount: '2.34'
		}
	})
})
it('applies explicit edits while preserving other fields and rejects invalid retention metadata', () => {
	const source = { description: 'Original', memo: 'Memo '.repeat(2000), check: null }
	expect(
		mergeTransactionTextDraft(
			{ retainedFields: ['memo'], description: 'Changed', memo: 'preview' },
			source
		)
	).toEqual({ kind: 'valid', values: { description: 'Changed', memo: source.memo } })
	expect(
		mergeTransactionTextDraft({ retainedFields: ['accountId'], accountId: 'foreign' }, source)
	).toEqual({ kind: 'invalid' })
	expect(mergeTransactionTextDraft({ retainedFields: ['memo'] }, null)).toEqual({ kind: 'invalid' })
})
