import { createAsyncLogic, setup, types, type ActorRefFrom } from 'xstate'
import {
	NATIVE_TEXT_CHUNK_SIZE,
	nativeTextReplySchema,
	type NativeTextCommand,
	type NativeTextField,
	type NativeTextReference,
	type NativeTextReply
} from '../../contracts/native-text-transfer.js'

type Request = { kind: 'read' } | { kind: 'write'; text: string }
type Input = {
	requestId: string
	field: NativeTextField
	request: Request
	exchange: (
		command: NativeTextCommand,
		signal: AbortSignal
	) => Promise<NativeTextReply | undefined>
}
type Result =
	| { outcome: 'read'; text: string }
	| { outcome: 'written'; reference: NativeTextReference }
	| { outcome: 'cancelled' | 'unavailable' }
type Piece = { text: string; previous: Piece | undefined }
type Context = Input & {
	offset: number
	index: number
	total: number | undefined
	pieces: Piece | undefined
	result: Result
}
const exchange = createAsyncLogic({
	run: ({
		input,
		signal
	}: {
		input: { transport: Input['exchange']; command: NativeTextCommand }
		signal: AbortSignal
	}) => input.transport(input.command, signal)
})
function validReply(context: Context, value: unknown) {
	const parsed = nativeTextReplySchema.safeParse(value)
	return parsed.success &&
		parsed.data.requestId === context.requestId &&
		parsed.data.field === context.field
		? parsed.data
		: undefined
}
function readText(piece: Piece): string {
	const parts: string[] = []
	for (let cursor: Piece | undefined = piece; cursor; cursor = cursor.previous)
		parts.push(cursor.text)
	return parts.reverse().join('')
}
/** Window owns native text presentation and wire framing only. Every exchange is
 * bounded; canonical validation, references and financial saves stay in Worker. */
export const nativeTextIoMachine = setup({
	schemas: {
		input: types<Input>(),
		context: types<Context>(),
		events: { CANCEL: types(), SHUTDOWN: types() },
		output: types<Result>(),
		children: { frame: types<ActorRefFrom<typeof exchange>>() }
	},
	actors: { exchange }
}).createMachine({
	id: 'native-text-io',
	initial: 'choosing',
	context: ({ input }) => ({
		...input,
		offset: 0,
		index: 0,
		total: undefined,
		pieces: undefined,
		result: { outcome: 'unavailable' }
	}),
	output: ({ context }) => context.result,
	on: {
		CANCEL: {
			target: '.cancelling',
			context: { pieces: undefined, result: { outcome: 'cancelled' } }
		},
		SHUTDOWN: {
			target: '.cancelling',
			context: { pieces: undefined, result: { outcome: 'cancelled' } }
		}
	},
	states: {
		choosing: {
			always: ({ context }) => ({
				target: context.request.kind === 'read' ? 'reading' : 'starting'
			})
		},
		reading: {
			invoke: {
				id: 'frame',
				src: 'exchange',
				input: ({ context }) => ({
					transport: context.exchange,
					command:
						context.offset === 0
							? { type: 'READ', requestId: context.requestId, field: context.field }
							: { type: 'NEXT', requestId: context.requestId, offset: context.offset }
				}),
				onDone: ({ context, event }) => {
					const reply = validReply(context, event.output)
					if (
						!reply ||
						reply.status !== 'chunk' ||
						reply.offset !== context.offset ||
						(context.total !== undefined && reply.total !== context.total) ||
						reply.offset + reply.text.length > reply.total ||
						reply.done !== (reply.offset + reply.text.length === reply.total) ||
						(!reply.done && !reply.text.length)
					)
						return { target: 'cancelling', context: { pieces: undefined } }
					const pieces = { text: reply.text, previous: context.pieces }
					return reply.done
						? {
								target: 'complete',
								context: { pieces: undefined, result: { outcome: 'read', text: readText(pieces) } }
							}
						: {
								target: 'reading',
								reenter: true,
								context: { pieces, offset: context.offset + reply.text.length, total: reply.total }
							}
				},
				onError: { target: 'cancelling', context: { pieces: undefined } }
			}
		},
		starting: {
			invoke: {
				id: 'frame',
				src: 'exchange',
				input: ({ context }) => ({
					transport: context.exchange,
					command: { type: 'START', requestId: context.requestId, field: context.field }
				}),
				onDone: ({ context, event }) => {
					const reply = validReply(context, event.output)
					if (
						!reply ||
						reply.status !== 'receiving' ||
						reply.index !== 0 ||
						reply.total !== 0 ||
						context.request.kind !== 'write'
					)
						return { target: 'cancelling' }
					return { target: context.request.text.length ? 'writing' : 'committing' }
				},
				onError: { target: 'cancelling' }
			}
		},
		writing: {
			invoke: {
				id: 'frame',
				src: 'exchange',
				input: ({ context }) => ({
					transport: context.exchange,
					command: {
						type: 'CHUNK',
						requestId: context.requestId,
						index: context.index,
						text:
							context.request.kind === 'write'
								? context.request.text.slice(
										context.offset,
										context.offset + NATIVE_TEXT_CHUNK_SIZE
									)
								: ''
					}
				}),
				onDone: ({ context, event }) => {
					if (context.request.kind !== 'write') return { target: 'cancelling' }
					const reply = validReply(context, event.output)
					const offset = Math.min(
						context.offset + NATIVE_TEXT_CHUNK_SIZE,
						context.request.text.length
					)
					if (
						!reply ||
						reply.status !== 'receiving' ||
						reply.index !== context.index + 1 ||
						reply.total !== offset
					)
						return { target: 'cancelling' }
					return {
						target: offset === context.request.text.length ? 'committing' : 'writing',
						reenter: true,
						context: { offset, index: context.index + 1 }
					}
				},
				onError: { target: 'cancelling' }
			}
		},
		committing: {
			invoke: {
				id: 'frame',
				src: 'exchange',
				input: ({ context }) => ({
					transport: context.exchange,
					command: { type: 'COMMIT', requestId: context.requestId, parts: context.index }
				}),
				onDone: ({ context, event }) => {
					const reply = validReply(context, event.output)
					if (
						!reply ||
						reply.status !== 'ready' ||
						!reply.done ||
						!reply.reference ||
						reply.version < 1 ||
						reply.index !== context.index ||
						reply.total !== context.offset
					)
						return { target: 'cancelling' }
					return {
						target: 'complete',
						context: {
							result: {
								outcome: 'written',
								reference: {
									kind: 'text',
									textScope: reply.textScope,
									reference: reply.reference,
									version: reply.version
								}
							}
						}
					}
				},
				onError: { target: 'cancelling' }
			}
		},
		cancelling: {
			on: { CANCEL: {}, SHUTDOWN: {} },
			invoke: {
				id: 'frame',
				src: 'exchange',
				input: ({ context }) => ({
					transport: context.exchange,
					command: { type: 'CANCEL', requestId: context.requestId }
				}),
				onDone: { target: 'complete' },
				onError: { target: 'complete' }
			}
		},
		complete: { type: 'final' }
	}
})
