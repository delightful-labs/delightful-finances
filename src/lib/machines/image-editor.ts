import { assign, fromPromise, setup, type SnapshotFrom } from 'xstate'
import {
	initialImageSelection,
	moveImageSelection,
	selectionQuad,
	validImageQuad,
	type ImageCorner,
	type ImagePoint,
	type ImageSelection,
	type ImageSelectionMode
} from '#lib/domain/image-editor-geometry.js'
import { renderEditorPixels, type ImageAdjustments } from '#lib/domain/image-editor-pixels.js'
import * as platform from '#lib/domain/image-editor-platform.js'

export type ImageEditorInput = { file: File; mode?: ImageSelectionMode }
export type ImageEditorOutput =
	| { kind: 'applied'; file: File }
	| { kind: 'cancelled' | 'closed' }
	| { kind: 'failed'; reason: 'input' | 'decode' | 'read' | 'render' | 'encode' | 'cleanup' }
type DragTarget = { kind: 'move' } | { kind: 'corner'; corner: ImageCorner }
type DragOrigin = { point: ImagePoint; selection: ImageSelection; target: DragTarget }
export type ImageEditorEvent =
	| { type: 'BEGIN_DRAG'; point: ImagePoint; target: DragTarget }
	| { type: 'DRAG'; point: ImagePoint }
	| { type: 'END_DRAG' }
	| { type: 'NUDGE'; delta: ImagePoint; target: DragTarget }
	| { type: 'SET_MODE'; mode: ImageSelectionMode }
	| { type: 'SET_CONTRAST'; value: number }
	| { type: 'SET_BLACK_WHITE'; value: boolean }
	| { type: 'PREVIEW' | 'EDIT' | 'RESET' | 'APPLY' | 'CANCEL' | 'SHUTDOWN' | 'DISPLAY_FAILED' }
type Context = {
	file: File
	mode: ImageSelectionMode
	bitmap: ImageBitmap | undefined
	source: ImageData | undefined
	selection: ImageSelection | undefined
	adjustments: ImageAdjustments
	drag: DragOrigin | undefined
	preview: ImageData | undefined
	rendered: ImageData | undefined
	canvas: HTMLCanvasElement | undefined
	result: ImageEditorOutput | undefined
}
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing image editor resource')
	return value
}
function failed(
	context: Context,
	reason: Extract<ImageEditorOutput, { kind: 'failed' }>['reason']
): ImageEditorOutput {
	return context.result && context.result.kind !== 'applied'
		? context.result
		: { kind: 'failed', reason }
}
function cancelled(context: Context): ImageEditorOutput {
	return context.result?.kind === 'closed' ? context.result : { kind: 'cancelled' }
}
function renderInput(context: Context) {
	return {
		source: required(context.source),
		selection: required(context.selection),
		adjustments: context.adjustments
	}
}
function nudge(context: Context, target: DragTarget, delta: ImagePoint) {
	return moveImageSelection(
		required(context.selection),
		{ ...target, delta },
		required(context.source)
	)
}

const decode = fromPromise(({ input }: { input: File }) => platform.decodeEditorImage(input))
const read = fromPromise(async ({ input }: { input: ImageBitmap }) =>
	platform.readEditorSource(input)
)
const render = fromPromise(async ({ input }: { input: ReturnType<typeof renderInput> }) =>
	renderEditorPixels(input.source, input.selection, input.adjustments)
)
const allocate = fromPromise(async () => platform.createEditorCanvas())
const paint = fromPromise(
	async ({ input }: { input: { canvas: HTMLCanvasElement; pixels: ImageData } }) =>
		platform.paintEditorCanvas(input.canvas, input.pixels)
)
const encode = fromPromise(
	({ input }: { input: { canvas: HTMLCanvasElement; mimeType: string } }) =>
		platform.encodeEditorCanvas(input.canvas, input.mimeType)
)
const closeBitmap = fromPromise(async ({ input }: { input: ImageBitmap }) => input.close())
const closeCanvas = fromPromise(async ({ input }: { input: HTMLCanvasElement }) =>
	platform.releaseEditorCanvas(input)
)

/** Owns editing and export resources; callers drain SHUTDOWN before stopping the actor. */
export const imageEditorMachine = setup<
	Context,
	ImageEditorEvent,
	{
		decode: typeof decode
		read: typeof read
		render: typeof render
		allocate: typeof allocate
		paint: typeof paint
		encode: typeof encode
		closeBitmap: typeof closeBitmap
		closeCanvas: typeof closeCanvas
	},
	{},
	{ cancel: undefined; shutdown: undefined },
	{},
	never,
	string,
	ImageEditorInput,
	ImageEditorOutput
>({
	actors: { decode, read, render, allocate, paint, encode, closeBitmap, closeCanvas },
	actions: {
		cancel: assign({ result: ({ context }) => cancelled(context) }),
		shutdown: assign({ result: (): ImageEditorOutput => ({ kind: 'closed' }) })
	}
}).createMachine({
	id: 'image-editor',
	initial: 'validating',
	context: ({ input }) => ({
		file: input.file,
		mode: input.mode ?? 'perspective',
		bitmap: undefined,
		source: undefined,
		selection: undefined,
		adjustments: { blackWhite: false, contrast: 100 },
		drag: undefined,
		preview: undefined,
		rendered: undefined,
		canvas: undefined,
		result: undefined
	}),
	output: ({ context }) => context.result ?? { kind: 'failed', reason: 'input' },
	// Pending native operations retain their invocation until settlement. Completion
	// transitions consume this requested terminal result before starting another operation.
	on: { CANCEL: { actions: 'cancel' }, SHUTDOWN: { actions: 'shutdown' } },
	states: {
		validating: {
			always: [
				{
					guard: ({ context }) =>
						context.file.size > 0 &&
						['image/png', 'image/jpeg', 'image/webp'].includes(context.file.type),
					target: 'decoding'
				},
				{
					target: 'failed',
					actions: assign({
						result: (): ImageEditorOutput => ({ kind: 'failed', reason: 'input' })
					})
				}
			]
		},
		decoding: {
			invoke: {
				src: 'decode',
				input: ({ context }) => context.file,
				onDone: [
					{
						guard: ({ context }) => context.result !== undefined,
						target: 'cleanup',
						actions: assign({ bitmap: ({ event }) => event.output })
					},
					{ target: 'readingSource', actions: assign({ bitmap: ({ event }) => event.output }) }
				],
				onError: {
					target: 'cleanup',
					actions: assign({ result: ({ context }) => failed(context, 'decode') })
				}
			}
		},
		readingSource: {
			invoke: {
				src: 'read',
				input: ({ context }) => required(context.bitmap),
				onDone: [
					{ guard: ({ context }) => context.result !== undefined, target: 'cleanup' },
					{
						target: 'closingSource',
						actions: assign({
							source: ({ event }) => event.output,
							selection: ({ context, event }) => initialImageSelection(context.mode, event.output)
						})
					}
				],
				onError: {
					target: 'cleanup',
					actions: assign({ result: ({ context }) => failed(context, 'read') })
				}
			}
		},
		closingSource: {
			invoke: {
				src: 'closeBitmap',
				input: ({ context }) => required(context.bitmap),
				onDone: [
					{
						guard: ({ context }) => context.result !== undefined,
						target: 'cleanup',
						actions: assign({ bitmap: undefined })
					},
					{ target: 'interactive', actions: assign({ bitmap: undefined }) }
				],
				onError: {
					target: 'cleanup',
					actions: assign({
						bitmap: undefined,
						result: ({ context }) => failed(context, 'cleanup')
					})
				}
			}
		},
		interactive: {
			initial: 'editing',
			on: {
				DISPLAY_FAILED: {
					target: 'cleanup',
					actions: assign({ result: ({ context }) => failed(context, 'render') })
				},
				CANCEL: { target: 'cleanup', actions: 'cancel' },
				SHUTDOWN: { target: 'cleanup', actions: 'shutdown' },
				SET_MODE: {
					target: '.editing.idle',
					actions: assign({
						mode: ({ event }) => event.mode,
						selection: ({ context, event }) =>
							initialImageSelection(event.mode, required(context.source)),
						drag: undefined,
						preview: undefined
					})
				},
				SET_CONTRAST: {
					guard: ({ event }) => Number.isFinite(event.value),
					target: '.editing.idle',
					actions: assign({
						adjustments: ({ context, event }) => ({
							...context.adjustments,
							contrast: Math.max(0, Math.min(200, event.value))
						}),
						drag: undefined,
						preview: undefined
					})
				},
				SET_BLACK_WHITE: {
					target: '.editing.idle',
					actions: assign({
						adjustments: ({ context, event }) => ({
							...context.adjustments,
							blackWhite: event.value
						}),
						drag: undefined,
						preview: undefined
					})
				},
				RESET: {
					target: '.editing.idle',
					actions: assign({
						selection: ({ context }) =>
							initialImageSelection(context.mode, required(context.source)),
						adjustments: () => ({ blackWhite: false, contrast: 100 }),
						drag: undefined,
						preview: undefined
					})
				},
				APPLY: {
					guard: ({ context }) =>
						validImageQuad(selectionQuad(required(context.selection)), required(context.source)),
					target: 'renderingApply',
					actions: assign({ drag: undefined, preview: undefined })
				}
			},
			states: {
				editing: {
					initial: 'idle',
					on: {
						PREVIEW: {
							target: '#image-editor.interactive.renderingPreview',
							actions: assign({ drag: undefined })
						},
						NUDGE: {
							target: '.idle',
							actions: assign({
								selection: ({ context, event }) => nudge(context, event.target, event.delta),
								drag: undefined
							})
						}
					},
					states: {
						idle: {
							on: {
								BEGIN_DRAG: {
									guard: ({ event }) =>
										Number.isFinite(event.point.x) && Number.isFinite(event.point.y),
									target: 'dragging',
									actions: assign({
										drag: ({ context, event }) => ({
											point: event.point,
											target: event.target,
											selection: required(context.selection)
										})
									})
								}
							}
						},
						dragging: {
							on: {
								DRAG: {
									actions: assign({
										selection: ({ context, event }) => {
											const origin = required(context.drag)
											return moveImageSelection(
												origin.selection,
												{
													...origin.target,
													delta: {
														x: event.point.x - origin.point.x,
														y: event.point.y - origin.point.y
													}
												},
												required(context.source)
											)
										}
									})
								},
								END_DRAG: { target: 'idle', actions: assign({ drag: undefined }) }
							}
						}
					}
				},
				renderingPreview: {
					invoke: {
						src: 'render',
						input: ({ context }) => renderInput(context),
						onDone: {
							target: 'previewReady',
							actions: assign({ preview: ({ event }) => event.output })
						},
						onError: {
							target: '#image-editor.cleanup',
							actions: assign({ result: ({ context }) => failed(context, 'render') })
						}
					}
				},
				previewReady: {
					on: { EDIT: { target: 'editing', actions: assign({ preview: undefined }) } }
				}
			}
		},
		renderingApply: {
			invoke: {
				src: 'render',
				input: ({ context }) => renderInput(context),
				onDone: [
					{ guard: ({ context }) => context.result !== undefined, target: 'cleanup' },
					{ target: 'creatingCanvas', actions: assign({ rendered: ({ event }) => event.output }) }
				],
				onError: {
					target: 'cleanup',
					actions: assign({ result: ({ context }) => failed(context, 'render') })
				}
			}
		},
		creatingCanvas: {
			invoke: {
				src: 'allocate',
				onDone: [
					{
						guard: ({ context }) => context.result !== undefined,
						target: 'cleanup',
						actions: assign({ canvas: ({ event }) => event.output })
					},
					{ target: 'painting', actions: assign({ canvas: ({ event }) => event.output }) }
				],
				onError: {
					target: 'cleanup',
					actions: assign({ result: ({ context }) => failed(context, 'render') })
				}
			}
		},
		painting: {
			invoke: {
				src: 'paint',
				input: ({ context }) => ({
					canvas: required(context.canvas),
					pixels: required(context.rendered)
				}),
				onDone: [
					{ guard: ({ context }) => context.result !== undefined, target: 'cleanup' },
					{ target: 'encoding' }
				],
				onError: {
					target: 'cleanup',
					actions: assign({ result: ({ context }) => failed(context, 'render') })
				}
			}
		},
		encoding: {
			invoke: {
				src: 'encode',
				input: ({ context }) => ({ canvas: required(context.canvas), mimeType: context.file.type }),
				onDone: [
					{ guard: ({ context }) => context.result !== undefined, target: 'cleanup' },
					{
						guard: ({ context, event }) =>
							event.output !== null &&
							event.output.size > 0 &&
							event.output.type === context.file.type,
						target: 'cleanup',
						actions: assign({
							result: ({ context, event }): ImageEditorOutput => ({
								kind: 'applied',
								file: new File([required(event.output ?? undefined)], context.file.name, {
									type: context.file.type
								})
							})
						})
					},
					{
						target: 'cleanup',
						actions: assign({ result: ({ context }) => failed(context, 'encode') })
					}
				],
				onError: {
					target: 'cleanup',
					actions: assign({ result: ({ context }) => failed(context, 'encode') })
				}
			}
		},
		cleanup: {
			initial: 'bitmap',
			onDone: 'settling',
			states: {
				bitmap: {
					always: [
						{ guard: ({ context }) => context.bitmap !== undefined, target: 'closingBitmap' },
						{ target: 'canvas' }
					]
				},
				closingBitmap: {
					invoke: {
						src: 'closeBitmap',
						input: ({ context }) => required(context.bitmap),
						onDone: { target: 'canvas', actions: assign({ bitmap: undefined }) },
						onError: {
							target: 'canvas',
							actions: assign({
								bitmap: undefined,
								result: ({ context }) => failed(context, 'cleanup')
							})
						}
					}
				},
				canvas: {
					always: [
						{ guard: ({ context }) => context.canvas !== undefined, target: 'closingCanvas' },
						{ target: 'done' }
					]
				},
				closingCanvas: {
					invoke: {
						src: 'closeCanvas',
						input: ({ context }) => required(context.canvas),
						onDone: { target: 'done', actions: assign({ canvas: undefined }) },
						onError: {
							target: 'done',
							actions: assign({
								canvas: undefined,
								result: ({ context }) => failed(context, 'cleanup')
							})
						}
					}
				},
				done: { type: 'final' }
			}
		},
		settling: {
			entry: assign({
				source: undefined,
				preview: undefined,
				rendered: undefined,
				drag: undefined
			}),
			always: [
				{ guard: ({ context }) => context.result?.kind === 'applied', target: 'applied' },
				{ guard: ({ context }) => context.result?.kind === 'cancelled', target: 'cancelled' },
				{ guard: ({ context }) => context.result?.kind === 'closed', target: 'closed' },
				{ target: 'failed' }
			]
		},
		applied: { type: 'final' },
		cancelled: { type: 'final' },
		closed: { type: 'final' },
		failed: { type: 'final' }
	}
})

export type ImageEditorPresentation = {
	status:
		| 'loading'
		| 'editing'
		| 'preview'
		| 'rendering'
		| 'exporting'
		| 'closing'
		| 'failed'
		| 'finished'
	viewport:
		| { kind: 'empty' }
		| {
				kind: 'selection'
				pixels: ImageData
				selection: ImageSelection
				adjustments: ImageAdjustments
				enabled: boolean
		  }
		| { kind: 'preview'; pixels: ImageData }
	mode: ImageSelectionMode
	adjustments: ImageAdjustments
	busy: boolean
	controls: {
		adjust: boolean
		apply: boolean
		preview: boolean
		edit: boolean
		reset: boolean
		cancel: boolean
	}
}

/** The editor owns capabilities; presentation renders them without inspecting actor states. */
export function imageEditorPresentation(
	snapshot: SnapshotFrom<typeof imageEditorMachine>
): ImageEditorPresentation {
	const { source, selection, preview, mode, adjustments } = snapshot.context
	const editing = snapshot.matches({ interactive: 'editing' })
	const previewing = snapshot.matches({ interactive: 'previewReady' })
	const status: ImageEditorPresentation['status'] =
		snapshot.status === 'error' || snapshot.matches('failed')
			? 'failed'
			: snapshot.status === 'done'
				? 'finished'
				: editing
					? 'editing'
					: previewing
						? 'preview'
						: snapshot.matches({ interactive: 'renderingPreview' }) ||
							  snapshot.matches('renderingApply')
							? 'rendering'
							: snapshot.matches('creatingCanvas') ||
								  snapshot.matches('painting') ||
								  snapshot.matches('encoding')
								? 'exporting'
								: snapshot.matches('cleanup') || snapshot.matches('settling')
									? 'closing'
									: 'loading'
	const viewport: ImageEditorPresentation['viewport'] =
		previewing && preview
			? { kind: 'preview', pixels: preview }
			: source && selection && ['editing', 'rendering', 'exporting'].includes(status)
				? { kind: 'selection', pixels: source, selection, adjustments, enabled: editing }
				: { kind: 'empty' }
	return {
		status,
		viewport,
		mode,
		adjustments,
		busy:
			status === 'loading' ||
			status === 'rendering' ||
			status === 'exporting' ||
			status === 'closing',
		controls: {
			adjust: editing || previewing,
			apply: editing || previewing,
			preview: editing,
			edit: previewing,
			reset: editing || previewing,
			cancel: snapshot.status === 'active' || status === 'failed'
		}
	}
}
