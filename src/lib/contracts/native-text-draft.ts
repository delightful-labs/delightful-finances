import { z } from 'zod'
import {
	nativeTextReferenceSchema,
	type NativeTextField,
	type NativeTextReference
} from './native-text-transfer.js'

/** Resolve only explicit field references, before canonical domain validation.
 * A stale or wrong-field reference must reject the whole draft atomically. */
export function resolveNativeTextDraft(
	values: unknown,
	fields: readonly NativeTextField[],
	resolve: (field: NativeTextField, reference: NativeTextReference) => string | undefined
): { kind: 'valid'; values: Record<string, unknown> } | { kind: 'invalid' } {
	const parsed = z.record(z.string(), z.unknown()).safeParse(values)
	if (!parsed.success) return { kind: 'invalid' }
	const draft = { ...parsed.data }
	for (const field of fields) {
		const value = draft[field]
		if (value === undefined || typeof value === 'string') continue
		const reference = nativeTextReferenceSchema.safeParse(value)
		if (!reference.success) return { kind: 'invalid' }
		const text = resolve(field, reference.data)
		if (text === undefined) return { kind: 'invalid' }
		draft[field] = text
	}
	return { kind: 'valid', values: draft }
}
