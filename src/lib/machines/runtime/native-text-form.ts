import {
	setup,
	types,
	matchesState,
	type ActorRefFrom,
	type InputFrom,
	type SnapshotFrom
} from 'xstate'
import { nativeTextIoMachine } from './native-text-io.js'
import { NATIVE_TEXT_CHUNK_SIZE } from '../../contracts/native-text-transfer.js'
import type { TransactionTextField } from '../../contracts/transaction-text-draft.js'
import type { TransactionRouteIntent } from '../../runtime/worker/transaction-route-protocol.js'

export type NativeFormDraft = Extract<TransactionRouteIntent, { type: 'CHANGE' | 'SUBMIT' }>
type Capture = { command: NativeFormDraft; replaceable: boolean }
type Operation = { kind: 'read' | 'write'; field: TransactionTextField }
type Input = {
	requestId: string
	readFields: readonly TransactionTextField[]
	exchange: InputFrom<typeof nativeTextIoMachine>['exchange']
	loaded: (field: TransactionTextField, text: string) => void
	deliver: (command: NativeFormDraft) => void
	failed: () => void
}
type Context = Input & {
	current: Capture | undefined
	queue: readonly Capture[]
	index: number
	operation: Operation | undefined
}
const fields: readonly TransactionTextField[] = ['description', 'memo', 'checkNumber']
const limit = 32
function operation(value: Operation | undefined): Operation {
	if (!value) throw new Error('Missing native text operation')
	return value
}
function capture(value: Capture | undefined): Capture {
	if (!value) throw new Error('Missing native form capture')
	return value
}
/** Native I/O queue only: copies native input strings into bounded text frames
 * and forwards raw form intent. No finance parsing, authorization or validation. */
export const nativeTextFormMachine = setup({
	schemas: {
		input: types<Input>(),
		context: types<Context>(),
		events: { DRAFT: types<Capture>(), SHUTDOWN: types(), RETRY: types() },
		children: { text: types<ActorRefFrom<typeof nativeTextIoMachine>>() },
		output: types<{ outcome: 'released' }>()
	},
	actors: { text: nativeTextIoMachine }
}).createMachine({
	id: 'native-text-form',
	initial: 'loading',
	context: ({ input }) => ({
		...input,
		current: undefined,
		queue: [],
		index: 0,
		operation: undefined
	}),
	output: () => ({ outcome: 'released' }),
	on: {
		SHUTDOWN: {
			target: '.closed',
			context: { current: undefined, queue: [], operation: undefined }
		},
		DRAFT: ({ context, event }, enq) => {
			if (
				context.current?.command.type === 'SUBMIT' ||
				context.queue.some((item) => item.command.type === 'SUBMIT')
			)
				return
			const next = { command: event.command, replaceable: event.replaceable }
			const last = context.queue.at(-1)
			if (event.replaceable && last?.replaceable)
				return { context: { queue: [...context.queue.slice(0, -1), next] } }
			if (context.queue.length >= limit) {
				enq(context.failed)
				return
			}
			return { context: { queue: [...context.queue, next] } }
		}
	},
	states: {
		loading: {
			always: ({ context }) => {
				const field = context.readFields[context.index]
				return field
					? { target: 'transferring', context: { operation: { kind: 'read', field } } }
					: { target: 'idle', context: { index: 0 } }
			}
		},
		idle: {
			always: ({ context }) =>
				context.queue[0]
					? {
							target: 'preparing',
							context: { current: context.queue[0], queue: context.queue.slice(1), index: 0 }
						}
					: undefined,
			on: {
				DRAFT: ({ event }) => ({
					target: 'preparing',
					context: { current: { command: event.command, replaceable: event.replaceable }, index: 0 }
				})
			}
		},
		preparing: {
			always: ({ context }) => {
				const field = fields[context.index]
				if (!field) return { target: 'delivering' }
				const command = capture(context.current).command
				const value = command.values[field]
				return typeof value === 'string' && value.length > NATIVE_TEXT_CHUNK_SIZE
					? { target: 'transferring', context: { operation: { kind: 'write', field } } }
					: { target: 'preparing', reenter: true, context: { index: context.index + 1 } }
			}
		},
		transferring: {
			initial: 'open',
			invoke: {
				id: 'text',
				src: 'text',
				input: ({ context }) => {
					const current = operation(context.operation)
					const value = context.current?.command.values[current.field]
					return {
						requestId: context.requestId,
						field: current.field,
						exchange: context.exchange,
						request:
							current.kind === 'read'
								? { kind: 'read' }
								: { kind: 'write', text: typeof value === 'string' ? value : '' }
					}
				},
				onDone: ({ context, event, value }, enq) => {
					if (matchesState({ transferring: 'closing' }, value))
						return {
							target: 'closed',
							context: { current: undefined, queue: [], operation: undefined }
						}
					const current = operation(context.operation)
					if (current.kind === 'read' && event.output.outcome === 'read') {
						const text = event.output.text
						enq(() => context.loaded(current.field, text))
						return {
							target: 'loading',
							context: { index: context.index + 1, operation: undefined }
						}
					}
					if (current.kind === 'write' && event.output.outcome === 'written') {
						const original = capture(context.current)
						return {
							target: 'preparing',
							context: {
								index: context.index + 1,
								operation: undefined,
								current: {
									...original,
									command: {
										...original.command,
										values: { ...original.command.values, [current.field]: event.output.reference }
									}
								}
							}
						}
					}
					enq(context.failed)
					return {
						target: 'failed',
						context: { current: undefined, queue: [], operation: undefined }
					}
				},
				onError: ({ context, value }, enq) => {
					if (matchesState({ transferring: 'closing' }, value))
						return {
							target: 'closed',
							context: { current: undefined, queue: [], operation: undefined }
						}
					enq(context.failed)
					return {
						target: 'failed',
						context: { current: undefined, queue: [], operation: undefined }
					}
				}
			},
			states: {
				open: { on: { SHUTDOWN: { target: 'closing' } } },
				closing: {
					entry: ({ children }, enq) => {
						if (children.text) enq.sendTo(children.text, { type: 'SHUTDOWN' })
					},
					on: { SHUTDOWN: {}, DRAFT: {} }
				}
			}
		},
		delivering: {
			entry: ({ context }, enq) => {
				const command = capture(context.current).command
				enq(() => context.deliver(command))
			},
			always: { target: 'idle', context: { current: undefined, operation: undefined } }
		},
		failed: {
			on: {
				DRAFT: {},
				RETRY: {
					target: 'loading',
					context: { index: 0, current: undefined, queue: [], operation: undefined }
				}
			}
		},
		closed: { type: 'final' }
	}
})
export function selectNativeTextForm(
	snapshot: SnapshotFrom<typeof nativeTextFormMachine> | undefined
) {
	return {
		busy:
			!!snapshot &&
			!snapshot.matches('idle') &&
			!snapshot.matches('failed') &&
			!snapshot.matches('closed'),
		failed: snapshot?.matches('failed') === true,
		blocked:
			!snapshot ||
			snapshot.matches('closed') ||
			snapshot.matches('failed') ||
			snapshot.matches({ transferring: 'closing' }) ||
			snapshot.context.queue.length >= limit - 1 ||
			snapshot.context.current?.command.type === 'SUBMIT' ||
			snapshot.context.queue.some((item) => item.command.type === 'SUBMIT')
	}
}
