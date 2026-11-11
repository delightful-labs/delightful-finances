import {
	setup,
	types,
	matchesState,
	type ActorRefFrom,
	type InputFrom,
	type SnapshotFrom
} from 'xstate'
import { nativeTextIoMachine } from './native-text-io.js'
import {
	NATIVE_TEXT_CHUNK_SIZE,
	type NativeTextReference
} from '../../contracts/native-text-transfer.js'
export type NativeNameValue = string | NativeTextReference
type Input = { requestId: string; exchange: InputFrom<typeof nativeTextIoMachine>['exchange'] }
type Capture = { name: string; deliver: (name: NativeNameValue) => void }
type Context = Input & { capture: Capture | undefined; prepared: NativeNameValue | undefined }
function captured(value: Capture | undefined): Capture {
	if (!value) throw new Error('Missing native name capture')
	return value
}
/** Native string framing only. The immutable capture is forwarded after text
 * preparation; financial validation and persistence remain in Worker. */
export const nativeNameInputMachine = setup({
	schemas: {
		input: types<Input>(),
		context: types<Context>(),
		events: { PREPARE: types<Capture>(), SHUTDOWN: types() },
		children: { text: types<ActorRefFrom<typeof nativeTextIoMachine>>() },
		output: types<{ outcome: 'released' }>()
	},
	actors: { text: nativeTextIoMachine }
}).createMachine({
	id: 'native-name-input',
	initial: 'idle',
	context: ({ input }) => ({ ...input, capture: undefined, prepared: undefined }),
	output: () => ({ outcome: 'released' }),
	on: {
		SHUTDOWN: { target: '.closed', context: { capture: undefined, prepared: undefined } },
		PREPARE: {}
	},
	states: {
		idle: {
			on: {
				PREPARE: ({ event }) => ({
					target: 'choosing',
					context: { capture: { name: event.name, deliver: event.deliver }, prepared: undefined }
				})
			}
		},
		choosing: {
			always: ({ context }) =>
				captured(context.capture).name.length > NATIVE_TEXT_CHUNK_SIZE
					? { target: 'transferring' }
					: { target: 'delivering', context: { prepared: captured(context.capture).name } }
		},
		transferring: {
			initial: 'open',
			invoke: {
				id: 'text',
				src: 'text',
				input: ({ context }) => ({
					requestId: context.requestId,
					field: 'name',
					request: { kind: 'write', text: captured(context.capture).name },
					exchange: context.exchange
				}),
				onDone: ({ event, value }) =>
					matchesState({ transferring: 'closing' }, value)
						? { target: 'closed', context: { capture: undefined, prepared: undefined } }
						: event.output.outcome === 'written'
							? { target: 'delivering', context: { prepared: event.output.reference } }
							: { target: 'failed', context: { capture: undefined, prepared: undefined } },
				onError: ({ value }) => ({
					target: matchesState({ transferring: 'closing' }, value) ? 'closed' : 'failed',
					context: { capture: undefined, prepared: undefined }
				})
			},
			states: {
				open: { on: { SHUTDOWN: { target: 'closing' } } },
				closing: {
					entry: ({ children }, enq) => {
						if (children.text) enq.sendTo(children.text, { type: 'SHUTDOWN' })
					},
					on: { SHUTDOWN: {}, PREPARE: {} }
				}
			}
		},
		delivering: {
			entry: ({ context }, enq) => {
				const current = captured(context.capture),
					value = context.prepared
				if (value === undefined) throw new Error('Missing prepared native name')
				enq(() => current.deliver(value))
			},
			always: { target: 'idle', context: { capture: undefined, prepared: undefined } }
		},
		failed: {
			on: {
				PREPARE: ({ event }) => ({
					target: 'choosing',
					context: { capture: { name: event.name, deliver: event.deliver }, prepared: undefined }
				})
			}
		},
		closed: { type: 'final' }
	}
})
export function selectNativeNameInput(
	snapshot: SnapshotFrom<typeof nativeNameInputMachine> | undefined
) {
	return {
		busy: !snapshot || (!snapshot.matches('idle') && !snapshot.matches('failed')),
		failed: snapshot?.matches('failed') === true
	}
}
