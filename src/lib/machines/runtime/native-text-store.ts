import { setup, types, type SnapshotFrom } from 'xstate'
import {
	NATIVE_TEXT_CHUNK_SIZE,
	nativeTextCommandSchema,
	type NativeTextCommand,
	type NativeTextField,
	type NativeTextReference,
	type NativeTextReply
} from '../../contracts/native-text-transfer.js'

type Document = { reference: string; version: number; text: string }
type Piece = { text: string; previous: Piece | undefined }
type Context = {
	textScope: string
	source: (field: NativeTextField) => string | undefined
	canRead: (field: NativeTextField) => boolean
	canWrite: (field: NativeTextField) => boolean
	documents: Partial<Record<NativeTextField, Document>>
	request: { id: string; field: NativeTextField } | undefined
	read: string | undefined
	pieces: Piece | undefined
	index: number
	version: number
	length: number
	reply: NativeTextReply | undefined
}
type Input = Pick<Context, 'textScope' | 'source' | 'canRead' | 'canWrite'>
function receipt(
	context: Context,
	status: NativeTextReply['status'],
	values: Partial<
		Pick<NativeTextReply, 'offset' | 'total' | 'index' | 'text' | 'done' | 'reference' | 'version'>
	> = {}
): NativeTextReply {
	if (!context.request) throw new Error('Missing native text request')
	return {
		textScope: context.textScope,
		requestId: context.request.id,
		field: context.request.field,
		status,
		offset: 0,
		total: context.length,
		index: context.index,
		version: context.version,
		text: '',
		done: false,
		reference: null,
		...values
	}
}
function assemble(piece: Piece | undefined): string {
	const parts: string[] = []
	for (let cursor = piece; cursor; cursor = cursor.previous) parts.push(cursor.text)
	return parts.reverse().join('')
}
/** Native text I/O owns only staged strings. No SDK write or financial success
 * follows from a transport commit; the scoped form still validates/submits it. */
export const nativeTextStoreMachine = setup({
	schemas: {
		input: types<Input>(),
		context: types<Context>(),
		events: { COMMAND: types<{ command: NativeTextCommand }>(), RESET: types(), SHUTDOWN: types() },
		output: types<{ outcome: 'released' }>()
	}
}).createMachine({
	id: 'native-text-store',
	initial: 'available',
	context: ({ input }) => ({
		...input,
		documents: {},
		request: undefined,
		read: undefined,
		pieces: undefined,
		index: 0,
		version: 0,
		length: 0,
		reply: undefined
	}),
	output: () => ({ outcome: 'released' }),
	on: {
		RESET: {
			target: '.available',
			context: {
				documents: {},
				request: undefined,
				read: undefined,
				pieces: undefined,
				index: 0,
				length: 0,
				reply: undefined
			}
		},
		SHUTDOWN: {
			target: '.closed',
			context: {
				documents: {},
				request: undefined,
				read: undefined,
				pieces: undefined,
				index: 0,
				length: 0,
				reply: undefined
			}
		}
	},
	states: {
		available: {
			on: {
				COMMAND: ({ context, event }) => {
					const decoded = nativeTextCommandSchema.safeParse(event.command)
					if (!decoded.success) return
					const command = decoded.data
					if (command.type !== 'READ' && command.type !== 'START') return
					const request = { id: command.requestId, field: command.field }
					const next = { ...context, request, index: 0, length: 0 }
					if (command.type === 'START') {
						if (!context.canWrite(command.field))
							return { context: { request, reply: receipt(next, 'unavailable') } }
						return {
							target: 'receiving',
							context: {
								request,
								pieces: undefined,
								read: undefined,
								index: 0,
								length: 0,
								reply: receipt(next, 'receiving')
							}
						}
					}
					if (!context.canRead(command.field))
						return { context: { request, reply: receipt(next, 'unavailable') } }
					const read = context.documents[command.field]?.text ?? context.source(command.field)
					if (read === undefined)
						return { context: { request, reply: receipt(next, 'unavailable') } }
					const text = read.slice(0, NATIVE_TEXT_CHUNK_SIZE),
						done = text.length === read.length
					return {
						target: done ? 'available' : 'reading',
						context: {
							request,
							read: done ? undefined : read,
							pieces: undefined,
							index: 0,
							length: read.length,
							reply: receipt(next, 'chunk', { total: read.length, text, done })
						}
					}
				}
			}
		},
		reading: {
			on: {
				COMMAND: ({ context, event }) => {
					const decoded = nativeTextCommandSchema.safeParse(event.command)
					if (!decoded.success) return
					const command = decoded.data
					if (command.requestId !== context.request?.id) return
					if (command.type === 'CANCEL')
						return {
							target: 'available',
							context: { read: undefined, reply: receipt(context, 'cancelled', { done: true }) }
						}
					if (!context.canRead(context.request.field))
						return {
							target: 'available',
							context: { read: undefined, reply: receipt(context, 'unavailable', { done: true }) }
						}
					if (command.type !== 'NEXT') return
					const expected = (context.reply?.offset ?? 0) + (context.reply?.text.length ?? 0)
					if (command.offset !== expected || context.read === undefined)
						return {
							target: 'available',
							context: { read: undefined, reply: receipt(context, 'invalid', { done: true }) }
						}
					const text = context.read.slice(command.offset, command.offset + NATIVE_TEXT_CHUNK_SIZE)
					const done = command.offset + text.length === context.read.length
					return {
						target: done ? 'available' : 'reading',
						context: {
							read: done ? undefined : context.read,
							reply: receipt(context, 'chunk', { offset: command.offset, text, done })
						}
					}
				}
			}
		},
		receiving: {
			on: {
				COMMAND: ({ context, event }) => {
					const decoded = nativeTextCommandSchema.safeParse(event.command)
					if (!decoded.success) return
					const command = decoded.data
					if (command.requestId !== context.request?.id) return
					if (command.type === 'CANCEL')
						return {
							target: 'available',
							context: { pieces: undefined, reply: receipt(context, 'cancelled', { done: true }) }
						}
					if (!context.canWrite(context.request.field))
						return {
							target: 'available',
							context: { pieces: undefined, reply: receipt(context, 'unavailable', { done: true }) }
						}
					if (command.type === 'CHUNK') {
						if (command.index !== context.index)
							return {
								target: 'available',
								context: { pieces: undefined, reply: receipt(context, 'invalid', { done: true }) }
							}
						const index = context.index + 1,
							length = context.length + command.text.length
						return {
							context: {
								pieces: { text: command.text, previous: context.pieces },
								index,
								length,
								reply: receipt(context, 'receiving', { index, total: length })
							}
						}
					}
					if (command.type !== 'COMMIT') return
					if (command.parts !== context.index)
						return {
							target: 'available',
							context: { pieces: undefined, reply: receipt(context, 'invalid', { done: true }) }
						}
					if (context.version >= Number.MAX_SAFE_INTEGER)
						return {
							target: 'available',
							context: { pieces: undefined, reply: receipt(context, 'invalid', { done: true }) }
						}
					const version = context.version + 1
					const document = {
						reference: context.request.id,
						version,
						text: assemble(context.pieces)
					}
					return {
						target: 'available',
						context: {
							documents: { ...context.documents, [context.request.field]: document },
							version,
							pieces: undefined,
							reply: receipt(context, 'ready', {
								reference: document.reference,
								version,
								done: true
							})
						}
					}
				}
			}
		},
		closed: { type: 'final' }
	}
})
export function resolveNativeText(
	snapshot: SnapshotFrom<typeof nativeTextStoreMachine> | undefined,
	field: NativeTextField,
	reference: NativeTextReference
): string | undefined {
	if (
		!snapshot ||
		snapshot.status !== 'active' ||
		snapshot.context.textScope !== reference.textScope
	)
		return undefined
	const document = snapshot.context.documents[field]
	return document?.reference === reference.reference && document.version === reference.version
		? document.text
		: undefined
}
