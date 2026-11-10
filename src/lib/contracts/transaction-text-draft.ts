import { z } from 'zod'
export const transactionTextFieldSchema = z.enum(['description', 'memo', 'checkNumber'])
export type TransactionTextField = z.infer<typeof transactionTextFieldSchema>
const patch = z
	.object({ retainedFields: z.array(transactionTextFieldSchema).max(3) })
	.catchall(z.unknown())
export function mergeTransactionTextDraft(
	values: unknown,
	source:
		| {
				description?: string | null
				memo?: string | null
				check?: { checkNumber: string | null } | null
		  }
		| null
		| undefined
): { kind: 'valid'; values: unknown } | { kind: 'invalid' } {
	const marker = z.object({ retainedFields: z.unknown().optional() }).safeParse(values)
	if (!marker.success || marker.data.retainedFields === undefined) return { kind: 'valid', values }
	const parsed = patch.safeParse(values)
	if (!parsed.success || !source) return { kind: 'invalid' }
	const { retainedFields, ...draft } = parsed.data
	return {
		kind: 'valid',
		values: {
			...draft,
			...(retainedFields.includes('description') ? { description: source.description ?? '' } : {}),
			...(retainedFields.includes('memo') ? { memo: source.memo ?? '' } : {}),
			...(retainedFields.includes('checkNumber')
				? { checkNumber: source.check?.checkNumber ?? '' }
				: {})
		}
	}
}
