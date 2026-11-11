import { z } from 'zod'

export const NATIVE_TEXT_CHUNK_SIZE = 4096
export const nativeTextFieldSchema = z.enum(['description', 'memo', 'checkNumber', 'name'])
export type NativeTextField = z.infer<typeof nativeTextFieldSchema>
const requestId = z.uuid()
const offset = z.number().int().nonnegative().safe()
export const nativeTextCommandSchema = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('READ'), requestId, field: nativeTextFieldSchema }),
	z.strictObject({ type: z.literal('NEXT'), requestId, offset }),
	z.strictObject({ type: z.literal('START'), requestId, field: nativeTextFieldSchema }),
	z.strictObject({
		type: z.literal('CHUNK'),
		requestId,
		index: offset,
		text: z.string().max(NATIVE_TEXT_CHUNK_SIZE)
	}),
	z.strictObject({ type: z.literal('COMMIT'), requestId, parts: offset }),
	z.strictObject({ type: z.literal('CANCEL'), requestId })
])
export type NativeTextCommand = z.infer<typeof nativeTextCommandSchema>
export const nativeTextReplySchema = z.strictObject({
	textScope: z.string().min(1).max(256),
	requestId,
	field: nativeTextFieldSchema,
	status: z.enum(['chunk', 'receiving', 'ready', 'cancelled', 'unavailable', 'invalid']),
	offset,
	version: offset,
	total: offset,
	index: offset,
	text: z.string().max(NATIVE_TEXT_CHUNK_SIZE),
	done: z.boolean(),
	reference: requestId.nullable()
})
export type NativeTextReply = z.infer<typeof nativeTextReplySchema>
export const nativeTextReferenceSchema = z.strictObject({
	kind: z.literal('text'),
	textScope: z.string().min(1).max(256),
	reference: requestId,
	version: offset.positive()
})
export type NativeTextReference = z.infer<typeof nativeTextReferenceSchema>
