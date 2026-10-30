import {
	and,
	stateIn,
	assign,
	enqueueActions,
	setup,
	type ActorRefFrom,
	type SnapshotFrom
} from 'xstate'
import { imageEditorMachine } from '../../images/image-editor.js'
import {
	MAX_TRANSACTION_ATTACHMENT_BYTES,
	isTransactionAttachmentType
} from '#lib/domain/transaction-attachments.js'

type Input = { editable: boolean }
type Event =
	| { type: 'SELECT'; files: File[] }
	| { type: 'EDIT'; file: File }
	| { type: 'SET_EDITABLE'; editable: boolean }
	| { type: 'CLOSE' | 'SHUTDOWN' }
type Context = {
	files: File[]
	target: File | undefined
	editable: boolean
	error: 'invalidSelection' | 'editingFailed' | null
}
function editableImage(file: File): boolean {
	return (
		isTransactionAttachmentType(file.type) &&
		file.size > 0 &&
		file.size <= MAX_TRANSACTION_ATTACHMENT_BYTES
	)
}
function requiredFile(file: File | undefined): File {
	if (!file) throw new Error('Missing transaction image selection')
	return file
}

/** Draft selection owns one invoked editor, retained while cancellation drains its resources. */
export const transactionImageSelectionMachine = setup<
	Context,
	Event,
	{ editor: typeof imageEditorMachine },
	{},
	{ interrupt: { command: 'CANCEL' | 'SHUTDOWN' } },
	{ editorOpen: undefined; editorShuttingDown: undefined },
	never,
	string,
	Input,
	{ kind: 'closed' }
>({
	actors: { editor: imageEditorMachine },
	guards: {
		editorOpen: stateIn({ editing: 'open' }),
		editorShuttingDown: stateIn({ editing: 'shuttingDown' })
	},
	actions: {
		interrupt: enqueueActions(({ self, enqueue }, { command }) => {
			const child = self.getSnapshot().children.editor
			if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: command })
		})
	}
}).createMachine({
	id: 'transaction-image-selection',
	initial: 'checkingReadiness',
	context: ({ input }) => ({ files: [], target: undefined, editable: input.editable, error: null }),
	output: () => ({ kind: 'closed' }),
	on: {
		SET_EDITABLE: {
			target: '.checkingReadiness',
			actions: assign({ editable: ({ event }) => event.editable })
		},
		SHUTDOWN: { target: '.closed' }
	},
	states: {
		checkingReadiness: {
			entry: assign({ target: undefined }),
			always: [{ guard: ({ context }) => context.editable, target: 'ready' }, { target: 'locked' }]
		},
		ready: {
			on: {
				SELECT: { actions: assign({ files: ({ event }) => [...event.files], error: null }) },
				EDIT: [
					{
						guard: ({ context, event }) =>
							context.files.includes(event.file) && editableImage(event.file),
						target: 'editing',
						actions: assign({ target: ({ event }) => event.file, error: null })
					},
					{ actions: assign({ error: () => 'invalidSelection' }) }
				]
			}
		},
		locked: {},
		editing: {
			initial: 'open',
			invoke: {
				id: 'editor',
				src: 'editor',
				input: ({ context }) => ({ file: requiredFile(context.target), mode: 'perspective' }),
				onDone: [
					{
						guard: 'editorShuttingDown',
						target: 'closed'
					},
					{
						guard: and([
							'editorOpen',
							({ context, event }) =>
								context.editable &&
								context.target !== undefined &&
								context.files.includes(context.target) &&
								event.output.kind === 'applied' &&
								editableImage(event.output.file)
						]),
						target: 'checkingReadiness',
						actions: assign({
							files: ({ context, event }) => {
								const output = event.output
								return output.kind === 'applied'
									? context.files.map((file) => (file === context.target ? output.file : file))
									: context.files
							}
						})
					},
					{
						guard: and(['editorOpen', ({ event }) => event.output.kind === 'failed']),
						target: 'checkingReadiness',
						actions: assign({ error: () => 'editingFailed' })
					},
					{
						guard: and([
							'editorOpen',
							({ event }) => event.output.kind === 'applied' && !editableImage(event.output.file)
						]),
						target: 'checkingReadiness',
						actions: assign({ error: () => 'invalidSelection' })
					},
					{ target: 'checkingReadiness' }
				],
				onError: [
					{
						guard: 'editorShuttingDown',
						target: 'closed'
					},
					{ target: 'checkingReadiness', actions: assign({ error: () => 'editingFailed' }) }
				]
			},
			on: {
				CLOSE: {
					target: '.cancelling',
					actions: { type: 'interrupt', params: { command: 'CANCEL' } }
				},
				SELECT: {
					guard: ({ context }) => context.editable,
					target: '.cancelling',
					actions: [
						assign({ files: ({ event }) => [...event.files], error: null }),
						{ type: 'interrupt', params: { command: 'CANCEL' } }
					]
				},
				SET_EDITABLE: [
					{
						guard: ({ event }) => !event.editable,
						target: '.cancelling',
						actions: [
							assign({ editable: ({ event }) => event.editable }),
							{ type: 'interrupt', params: { command: 'CANCEL' } }
						]
					},
					{ actions: assign({ editable: ({ event }) => event.editable }) }
				],
				SHUTDOWN: {
					target: '.shuttingDown',
					actions: { type: 'interrupt', params: { command: 'SHUTDOWN' } }
				}
			},
			states: {
				open: {},
				cancelling: {},
				shuttingDown: { on: { CLOSE: {}, SELECT: {}, SET_EDITABLE: {}, SHUTDOWN: {} } }
			}
		},
		closed: { type: 'final' }
	}
})

export function transactionImageSelectionPresentation(
	snapshot: SnapshotFrom<typeof transactionImageSelectionMachine>
): {
	files: File[]
	canSelect: boolean
	editableFiles: readonly File[]
	error: Context['error']
	editor: { file: File; actor: ActorRefFrom<typeof imageEditorMachine> } | null
} {
	const child = snapshot.children.editor
	const file = snapshot.context.target
	const ready = snapshot.matches('ready')
	return {
		files: snapshot.context.files,
		canSelect: ready,
		editableFiles: ready ? snapshot.context.files.filter(editableImage) : [],
		error: snapshot.context.error,
		editor: snapshot.matches({ editing: 'open' }) && child && file ? { file, actor: child } : null
	}
}
