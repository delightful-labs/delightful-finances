import { assign, fromPromise, setup } from 'xstate'
import type { PicaCanvas } from 'pica'
import * as image from '#lib/domain/image-processing.js'

export type ImageProcessingInput = { file: File; options: image.ImageProcessingOptions }
export type ImageProcessingOutput =
	| { outcome: 'processed'; blob: Blob; bytes: Uint8Array; dimensions: image.ImageDimensions }
	| { outcome: 'failed' }
type Context = ImageProcessingInput & {
	bitmap: ImageBitmap | undefined
	canvas: PicaCanvas | undefined
	blob: Blob | undefined
	bytes: Uint8Array | undefined
	dimensions: image.ImageDimensions | undefined
	interrupted: boolean
	output: ImageProcessingOutput | undefined
}
type Event = { type: 'CANCEL' | 'SHUTDOWN' }

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing image processing resource')
	return value
}

/** Decodes, resizes, encodes, reads, and releases resources for one image. */
export const imageProcessingMachine = setup({
	types: {
		context: {} as Context,
		events: {} as Event,
		input: {} as ImageProcessingInput,
		output: {} as ImageProcessingOutput
	},
	actors: {
		decode: fromPromise(({ input }: { input: File }) => image.decodeImage(input)),
		initialize: fromPromise(async () => image.initializeImageResizer()),
		canvas: fromPromise(
			async ({
				input
			}: {
				input: { bitmap: ImageBitmap; options: image.ImageProcessingOptions }
			}) => image.createImageCanvas(input.bitmap, input.options)
		),
		resize: fromPromise(({ input }: { input: { bitmap: ImageBitmap; canvas: PicaCanvas } }) =>
			image.resizeImage(input.bitmap, input.canvas)
		),
		encode: fromPromise(
			({ input }: { input: { canvas: PicaCanvas; options: image.ImageProcessingOptions } }) =>
				image.encodeImage(input.canvas, input.options)
		),
		read: fromPromise(({ input }: { input: Blob }) => image.readImageBytes(input)),
		closeBitmap: fromPromise(async ({ input }: { input: ImageBitmap }) =>
			image.releaseImageBitmap(input)
		),
		closeCanvas: fromPromise(async ({ input }: { input: PicaCanvas }) =>
			image.releaseImageCanvas(input)
		)
	},
	actions: {
		interrupt: assign({ interrupted: () => true }),
		fail: assign({ output: () => ({ outcome: 'failed' as const }) }),
		processed: assign({
			output: ({ context }): ImageProcessingOutput =>
				context.blob && context.bytes && context.dimensions
					? {
							outcome: 'processed',
							blob: context.blob,
							bytes: context.bytes,
							dimensions: context.dimensions
						}
					: { outcome: 'failed' }
		})
	}
}).createMachine({
	id: 'image-processing',
	initial: 'decoding',
	context: ({ input }) => ({
		...input,
		bitmap: undefined,
		canvas: undefined,
		blob: undefined,
		bytes: undefined,
		dimensions: undefined,
		interrupted: false,
		output: undefined
	}),
	output: ({ context }) => context.output ?? { outcome: 'failed' },
	on: {
		CANCEL: { actions: 'interrupt' },
		SHUTDOWN: { actions: 'interrupt' }
	},
	states: {
		decoding: {
			invoke: {
				src: 'decode',
				input: ({ context }) => context.file,
				onDone: [
					{
						guard: ({ context }) => context.interrupted,
						target: 'cleanup',
						actions: assign({ bitmap: ({ event }) => event.output })
					},
					{ target: 'initializing', actions: assign({ bitmap: ({ event }) => event.output }) }
				],
				onError: { target: 'failed', actions: 'fail' }
			}
		},
		initializing: {
			invoke: {
				src: 'initialize',
				onDone: [
					{ guard: ({ context }) => context.interrupted, target: 'cleanup' },
					{ target: 'creatingCanvas' }
				],
				onError: { target: 'cleanup', actions: 'fail' }
			}
		},
		creatingCanvas: {
			invoke: {
				src: 'canvas',
				input: ({ context }) => ({ bitmap: required(context.bitmap), options: context.options }),
				onDone: [
					{
						guard: ({ context }) => context.interrupted,
						target: 'cleanup',
						actions: assign({ canvas: ({ event }) => event.output })
					},
					{
						target: 'resizing',
						actions: assign({
							canvas: ({ event }) => event.output,
							dimensions: ({ event }) => ({
								width: event.output.width,
								height: event.output.height
							})
						})
					}
				],
				onError: { target: 'cleanup', actions: 'fail' }
			}
		},
		resizing: {
			invoke: {
				src: 'resize',
				input: ({ context }) => ({
					bitmap: required(context.bitmap),
					canvas: required(context.canvas)
				}),
				onDone: [
					{ guard: ({ context }) => context.interrupted, target: 'cleanup' },
					{ target: 'encoding' }
				],
				onError: { target: 'cleanup', actions: 'fail' }
			}
		},
		encoding: {
			invoke: {
				src: 'encode',
				input: ({ context }) => ({ canvas: required(context.canvas), options: context.options }),
				onDone: [
					{
						guard: ({ context }) => context.interrupted,
						target: 'cleanup',
						actions: assign({ blob: ({ event }) => event.output ?? undefined })
					},
					{
						guard: ({ event }) => event.output instanceof Blob,
						target: 'reading',
						actions: assign({ blob: ({ event }) => event.output ?? undefined })
					},
					{ target: 'cleanup', actions: 'fail' }
				],
				onError: { target: 'cleanup', actions: 'fail' }
			}
		},
		reading: {
			invoke: {
				src: 'read',
				input: ({ context }) => required(context.blob),
				onDone: {
					target: 'cleanup',
					actions: assign({ bytes: ({ event }) => event.output })
				},
				onError: { target: 'cleanup', actions: 'fail' }
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
						onError: { target: 'canvas', actions: ['fail', assign({ bitmap: undefined })] }
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
						onError: { target: 'done', actions: ['fail', assign({ canvas: undefined })] }
					}
				},
				done: { type: 'final' }
			}
		},
		settling: {
			always: [
				{ guard: ({ context }) => context.output?.outcome === 'failed', target: 'failed' },
				{ guard: ({ context }) => context.interrupted, target: 'failed', actions: 'fail' },
				{ target: 'completed', actions: 'processed' }
			]
		},
		completed: { type: 'final' },
		failed: { type: 'final' }
	}
})
