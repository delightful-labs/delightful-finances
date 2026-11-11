import { setup, types, type ActorRefFrom, type SnapshotFrom } from 'xstate'
import { nativeTextStoreMachine, resolveNativeText } from './native-text-store.js'
import type {
	NativeTextCommand,
	NativeTextReference
} from '../../contracts/native-text-transfer.js'

type Input = { textScope: string; revision: () => number; canWrite: () => boolean }
/** One creation form's private native-name documents. Financial validation and
 * SDK writes remain owned by the canonical form child. */
export const nativeNameOwnerMachine = setup({
	schemas: {
		input: types<Input>(),
		context: types<Input & { draftRevision: number }>(),
		events: {
			TEXT: types<{ draftRevision: number; command: NativeTextCommand }>(),
			RESET: types(),
			SHUTDOWN: types()
		},
		children: { store: types<ActorRefFrom<typeof nativeTextStoreMachine>>() },
		output: types<{ outcome: 'released' }>()
	},
	actors: { store: nativeTextStoreMachine }
}).createMachine({
	id: 'native-name-owner',
	initial: 'open',
	context: ({ input }) => ({ ...input, draftRevision: -1 }),
	output: () => ({ outcome: 'released' }),
	invoke: {
		id: 'store',
		src: 'store',
		input: ({ context }) => ({
			textScope: context.textScope,
			source: () => '',
			canRead: (field) => field === 'name' && context.canWrite(),
			canWrite: (field) => field === 'name' && context.canWrite()
		}),
		onDone: { target: '.closed' }
	},
	states: {
		open: {
			on: {
				RESET: ({ context, children }, enq) => {
					if (children.store) enq.sendTo(children.store, { type: 'RESET' })
					return { context: { draftRevision: context.revision() } }
				},
				TEXT: ({ context, event, children }, enq) => {
					if (event.draftRevision !== context.revision()) return
					if (!children.store) return
					if (context.draftRevision !== event.draftRevision)
						enq.sendTo(children.store, { type: 'RESET' })
					enq.sendTo(children.store, { type: 'COMMAND', command: event.command })
					return { context: { draftRevision: event.draftRevision } }
				},
				SHUTDOWN: { target: 'closing' }
			}
		},
		closing: {
			entry: ({ children }, enq) => {
				if (children.store) enq.sendTo(children.store, { type: 'SHUTDOWN' })
			},
			on: { TEXT: {}, RESET: {}, SHUTDOWN: {} }
		},
		closed: { type: 'final' }
	}
})
export function selectNativeNameReply(
	snapshot: SnapshotFrom<typeof nativeNameOwnerMachine> | undefined
) {
	return snapshot?.matches('open') && snapshot.context.draftRevision === snapshot.context.revision()
		? snapshot.children.store?.getSnapshot().context.reply
		: undefined
}
export function resolveNativeName(
	snapshot: SnapshotFrom<typeof nativeNameOwnerMachine> | undefined,
	reference: NativeTextReference
) {
	if (!snapshot?.matches('open') || snapshot.context.draftRevision !== snapshot.context.revision())
		return undefined
	return resolveNativeText(snapshot.children.store?.getSnapshot(), 'name', reference)
}
