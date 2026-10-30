import {
	and,
	assign,
	enqueueActions,
	fromPromise,
	setup,
	stateIn,
	type ActorRefFrom,
	type OutputFrom,
	type SnapshotFrom
} from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '#lib/schema.js'
import { imageEditorMachine } from '../../images/image-editor.js'
import {
	transactionAttachmentReplacementMachine,
	type AttachmentReplacementInput,
	type AttachmentReplacementOutput
} from './transaction-attachment-replacement.js'
import {
	MAX_TRANSACTION_ATTACHMENT_BYTES,
	isTransactionAttachmentType
} from '#lib/domain/transaction-attachments.js'

type ImageReference = { id: string; fileId: string }
export type SavedImageObservation = {
	editable: boolean
	images: readonly ImageReference[]
	blockedIds: readonly string[]
}
type Db = Pick<ReturnType<typeof getDb>, 'one' | 'beginTransaction'>
type Input = {
	db: Db
	transaction: AttachmentReplacementInput['transaction']
	observation: SavedImageObservation
}
type Event =
	| { type: 'EDIT'; attachmentId: string }
	| { type: 'OBSERVE'; observation: SavedImageObservation }
	| { type: 'CLOSE' | 'SHUTDOWN' }
type Problem = 'unavailable' | 'conflict' | 'editingFailed' | 'saveFailed' | 'unresolved' | null
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing saved image resource')
	return value
}
function eligible(target: ImageReference, observation: SavedImageObservation): boolean {
	return (
		observation.editable &&
		!observation.blockedIds.includes(target.id) &&
		observation.images.some((image) => image.id === target.id && image.fileId === target.fileId)
	)
}
const hydrate = fromPromise(
	({ input }: { input: { db: Db; transactionId: string; target: ImageReference } }) =>
		input.db.one(
			app.transactionAttachments
				.where({
					id: input.target.id,
					transactionId: input.transactionId,
					fileId: input.target.fileId
				})
				.include({ file: { parts: true }, transaction: true }),
			{ tier: 'local' }
		)
)
function completeContents(row: OutputFrom<typeof hydrate>): boolean {
	const file = row?.file
	if (
		!file ||
		!isTransactionAttachmentType(file.mimeType) ||
		file.sizeBytes < 1 ||
		file.sizeBytes > MAX_TRANSACTION_ATTACHMENT_BYTES
	)
		return false
	const parts = [...(file.parts ?? [])].sort((left, right) => left.partIndex - right.partIndex)
	return (
		parts.length > 0 &&
		parts.every(
			(part, index) =>
				part.partIndex === index && part.data != null && part.data.byteLength === part.sizeBytes
		) &&
		parts.reduce((total, part) => total + part.sizeBytes, 0) === file.sizeBytes
	)
}
const assemble = fromPromise(
	async ({ input }: { input: NonNullable<OutputFrom<typeof hydrate>> }) => {
		const file = required(input.file ?? undefined)
		const bytes = new Uint8Array(file.sizeBytes)
		let offset = 0
		for (const part of [...(file.parts ?? [])].sort(
			(left, right) => left.partIndex - right.partIndex
		)) {
			const data = required(part.data ?? undefined)
			bytes.set(data, offset)
			offset += data.byteLength
		}
		return new File([bytes], file.fileName, { type: file.mimeType })
	}
)
const readBytes = fromPromise(
	async ({ input }: { input: File }) => new Uint8Array(await input.arrayBuffer())
)
type Context = Input & {
	target: ImageReference | undefined
	records: OutputFrom<typeof hydrate> | undefined
	source: File | undefined
	edited: File | undefined
	bytes: Uint8Array | undefined
	problem: Problem
}
function invalidObservation(context: Context, observation: SavedImageObservation): boolean {
	return context.target !== undefined && !eligible(context.target, observation)
}
function saveProblem(result: AttachmentReplacementOutput): Problem {
	if (result.settlement === 'unresolved') return 'unresolved'
	if (result.outcome === 'conflict') return 'conflict'
	return result.outcome === 'failed' ? 'saveFailed' : null
}

/** Reads a saved attachment, invokes the reusable editor, then owns its replacement operation. */
export const savedTransactionImageEditorMachine = setup<
	Context,
	Event,
	{
		hydrate: typeof hydrate
		assemble: typeof assemble
		editor: typeof imageEditorMachine
		readBytes: typeof readBytes
		persist: typeof transactionAttachmentReplacementMachine
	},
	{ editor: 'editor'; persist: 'persist' },
	{ interrupt: { child: 'editor' | 'persist'; command: 'CANCEL' | 'SHUTDOWN' } },
	{ editorOpen: undefined; editorClosing: undefined; saveClosing: undefined },
	never,
	string,
	Input,
	{ kind: 'closed' }
>({
	actors: {
		hydrate,
		assemble,
		editor: imageEditorMachine,
		readBytes,
		persist: transactionAttachmentReplacementMachine
	},
	guards: {
		editorOpen: stateIn({ editing: 'open' }),
		editorClosing: stateIn({ editing: 'shuttingDown' }),
		saveClosing: stateIn({ saving: 'shuttingDown' })
	},
	actions: {
		interrupt: enqueueActions(({ self, enqueue }, { child: id, command }) => {
			const child = self.getSnapshot().children[id]
			if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: command })
		})
	}
}).createMachine({
	id: 'saved-image-editor',
	initial: 'idle',
	context: ({ input }) => ({
		...input,
		target: undefined,
		records: undefined,
		source: undefined,
		edited: undefined,
		bytes: undefined,
		problem: null
	}),
	output: () => ({ kind: 'closed' }),
	on: {
		OBSERVE: [
			{
				guard: ({ context, event }) => invalidObservation(context, event.observation),
				target: '.idle',
				actions: assign({ observation: ({ event }) => event.observation })
			},
			{ actions: assign({ observation: ({ event }) => event.observation }) }
		],
		CLOSE: '.idle',
		SHUTDOWN: '.closed'
	},
	states: {
		idle: {
			entry: assign({
				target: undefined,
				records: undefined,
				source: undefined,
				edited: undefined,
				bytes: undefined
			}),
			on: {
				EDIT: {
					guard: ({ context, event }) =>
						context.observation.images.some(
							(image) => image.id === event.attachmentId && eligible(image, context.observation)
						),
					target: 'hydrating',
					actions: assign({
						target: ({ context, event }) =>
							context.observation.images.find((image) => image.id === event.attachmentId),
						problem: null
					})
				}
			}
		},
		hydrating: {
			invoke: {
				src: 'hydrate',
				input: ({ context }) => ({
					db: context.db,
					transactionId: context.transaction.id,
					target: required(context.target)
				}),
				onDone: [
					{
						guard: ({ context, event }) =>
							event.output !== null &&
							event.output.transaction?.accountId === context.transaction.accountId &&
							event.output.transaction.organizationId === context.transaction.organizationId &&
							completeContents(event.output),
						target: 'assembling',
						actions: assign({ records: ({ event }) => event.output })
					},
					{
						target: 'idle',
						actions: assign({
							problem: ({ event }) => (event.output === null ? 'conflict' : 'unavailable')
						})
					}
				],
				onError: { target: 'idle', actions: assign({ problem: () => 'unavailable' }) }
			}
		},
		assembling: {
			invoke: {
				src: 'assemble',
				input: ({ context }) => required(context.records ?? undefined),
				onDone: { target: 'editing', actions: assign({ source: ({ event }) => event.output }) },
				onError: { target: 'idle', actions: assign({ problem: () => 'unavailable' }) }
			}
		},
		editing: {
			initial: 'open',
			invoke: {
				id: 'editor',
				src: 'editor',
				input: ({ context }) => ({ file: required(context.source), mode: 'perspective' }),
				onDone: [
					{ guard: 'editorClosing', target: 'closed' },
					{
						guard: and([
							'editorOpen',
							({ context, event }) =>
								eligible(required(context.target), context.observation) &&
								event.output.kind === 'applied'
						]),
						target: 'readingBytes',
						actions: assign({
							edited: ({ event }) =>
								event.output.kind === 'applied' ? event.output.file : undefined
						})
					},
					{
						guard: and(['editorOpen', ({ event }) => event.output.kind === 'failed']),
						target: 'idle',
						actions: assign({ problem: () => 'editingFailed' })
					},
					{ target: 'idle' }
				],
				onError: [
					{ guard: 'editorClosing', target: 'closed' },
					{ target: 'idle', actions: assign({ problem: () => 'editingFailed' }) }
				]
			},
			on: {
				CLOSE: {
					target: '.cancelling',
					actions: { type: 'interrupt', params: { child: 'editor', command: 'CANCEL' } }
				},
				SHUTDOWN: {
					target: '.shuttingDown',
					actions: { type: 'interrupt', params: { child: 'editor', command: 'SHUTDOWN' } }
				},
				OBSERVE: [
					{
						guard: ({ context, event }) => invalidObservation(context, event.observation),
						target: '.cancelling',
						actions: [
							assign({ observation: ({ event }) => event.observation }),
							{ type: 'interrupt', params: { child: 'editor', command: 'CANCEL' } }
						]
					},
					{ actions: assign({ observation: ({ event }) => event.observation }) }
				]
			},
			states: {
				open: {},
				cancelling: {},
				shuttingDown: { on: { CLOSE: {}, SHUTDOWN: {}, OBSERVE: {} } }
			}
		},
		readingBytes: {
			invoke: {
				src: 'readBytes',
				input: ({ context }) => required(context.edited),
				onDone: { target: 'saving', actions: assign({ bytes: ({ event }) => event.output }) },
				onError: { target: 'idle', actions: assign({ problem: () => 'saveFailed' }) }
			}
		},
		saving: {
			initial: 'open',
			invoke: {
				id: 'persist',
				src: 'persist',
				input: ({ context }) => ({
					db: context.db,
					transaction: context.transaction,
					attachment: required(context.target),
					file: required(context.edited),
					bytes: required(context.bytes)
				}),
				onDone: [
					{ guard: 'saveClosing', target: 'closed' },
					{ target: 'idle', actions: assign({ problem: ({ event }) => saveProblem(event.output) }) }
				],
				onError: [
					{ guard: 'saveClosing', target: 'closed' },
					{ target: 'idle', actions: assign({ problem: () => 'unresolved' }) }
				]
			},
			on: {
				CLOSE: {
					target: '.cancelling',
					actions: { type: 'interrupt', params: { child: 'persist', command: 'CANCEL' } }
				},
				SHUTDOWN: {
					target: '.shuttingDown',
					actions: { type: 'interrupt', params: { child: 'persist', command: 'SHUTDOWN' } }
				},
				OBSERVE: [
					{
						guard: ({ context, event }) => invalidObservation(context, event.observation),
						target: '.cancelling',
						actions: [
							assign({ observation: ({ event }) => event.observation }),
							{ type: 'interrupt', params: { child: 'persist', command: 'CANCEL' } }
						]
					},
					{ actions: assign({ observation: ({ event }) => event.observation }) }
				]
			},
			states: {
				open: {},
				cancelling: {},
				shuttingDown: { on: { CLOSE: {}, SHUTDOWN: {}, OBSERVE: {} } }
			}
		},
		closed: { type: 'final' }
	}
})

export function savedImageEditorPresentation(
	snapshot: SnapshotFrom<typeof savedTransactionImageEditorMachine>
): {
	editableIds: readonly string[]
	disabledIds: readonly string[]
	problem: Problem
	dialog:
		| { kind: 'loading' | 'saving' }
		| { kind: 'editor'; file: File; actor: ActorRefFrom<typeof imageEditorMachine> }
		| null
} {
	const { target, observation, source } = snapshot.context
	const child = snapshot.children.editor
	const dialog =
		snapshot.matches({ editing: 'open' }) && source && child
			? ({ kind: 'editor', file: source, actor: child } satisfies {
					kind: 'editor'
					file: File
					actor: ActorRefFrom<typeof imageEditorMachine>
				})
			: snapshot.matches('hydrating') || snapshot.matches('assembling')
				? ({ kind: 'loading' } satisfies { kind: 'loading' })
				: snapshot.matches('readingBytes') || snapshot.matches({ saving: 'open' })
					? ({ kind: 'saving' } satisfies { kind: 'saving' })
					: null
	return {
		editableIds: snapshot.matches('idle')
			? observation.images.filter((image) => eligible(image, observation)).map(({ id }) => id)
			: [],
		disabledIds: target ? [...observation.blockedIds, target.id] : observation.blockedIds,
		problem: snapshot.context.problem,
		dialog
	}
}
