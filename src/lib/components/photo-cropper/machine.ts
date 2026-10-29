import { assign, fromPromise, setup } from 'xstate'

export type CropRect = { x: number; y: number; width: number; height: number }
export type CropperInput = {
	file: File
	aspectRatio: number
}
export type CropCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
type DragStart =
	| { x: number; y: number; crop: CropRect; mode: 'move' }
	| { x: number; y: number; crop: CropRect; mode: 'resize'; corner: CropCorner }
type Context = CropperInput & {
	bitmap: ImageBitmap | undefined
	imageSize: { width: number; height: number } | undefined
	crop: CropRect | undefined
	start: DragStart | undefined
	result: File | undefined
	failed: boolean
}
export type CropperEvent =
	| {
			type: 'POINTER_DOWN'
			point: { x: number; y: number }
			mode: 'move' | 'resize'
			corner?: CropCorner
	  }
	| { type: 'POINTER_MOVE'; point: { x: number; y: number } }
	| { type: 'POINTER_UP' }
	| { type: 'NUDGE'; mode: 'move' | 'resize'; corner?: CropCorner; delta: { x: number; y: number } }
	| { type: 'CROP' }
	| { type: 'CANCEL' }
type Output = { kind: 'cropped' | 'cancelled'; file: File }

function initialCrop(context: Context): CropRect {
	const image = context.imageSize
	if (!image) throw new Error('Image dimensions are unavailable')
	const width = Math.min(image.width, image.height * context.aspectRatio)
	const height = width / context.aspectRatio
	return { x: (image.width - width) / 2, y: (image.height - height) / 2, width, height }
}

function resizeCrop(
	context: Context,
	crop: CropRect,
	corner: CropCorner,
	deltaX: number,
	deltaY: number
): CropRect {
	const { imageSize, aspectRatio } = context
	if (!imageSize) return crop
	const left = corner === 'topLeft' || corner === 'bottomLeft'
	const top = corner === 'topLeft' || corner === 'topRight'
	const anchorX = left ? crop.x + crop.width : crop.x
	const anchorY = top ? crop.y + crop.height : crop.y
	const maxWidth = Math.min(
		left ? anchorX : imageSize.width - anchorX,
		(top ? anchorY : imageSize.height - anchorY) * aspectRatio
	)
	const horizontalWidth = crop.width + (left ? -deltaX : deltaX)
	const verticalWidth = (crop.height + (top ? -deltaY : deltaY)) * aspectRatio
	const preferredWidth =
		Math.abs(horizontalWidth - crop.width) >= Math.abs(verticalWidth - crop.width)
			? horizontalWidth
			: verticalWidth
	const width = Math.max(Math.min(1, maxWidth), Math.min(maxWidth, preferredWidth))
	const height = width / aspectRatio
	return { x: left ? anchorX - width : anchorX, y: top ? anchorY - height : anchorY, width, height }
}

function moveCrop(context: Context, point: { x: number; y: number }): CropRect | undefined {
	const { start, imageSize, crop } = context
	if (!start || !imageSize || !crop) return crop
	if (start.mode === 'move') {
		return {
			...crop,
			x: Math.max(0, Math.min(imageSize.width - crop.width, start.crop.x + point.x - start.x)),
			y: Math.max(0, Math.min(imageSize.height - crop.height, start.crop.y + point.y - start.y))
		}
	}
	return resizeCrop(context, start.crop, start.corner, point.x - start.x, point.y - start.y)
}

function nudgeCrop(
	context: Context,
	event: Extract<CropperEvent, { type: 'NUDGE' }>
): CropRect | undefined {
	const { crop, imageSize } = context
	if (!crop || !imageSize) return crop
	if (event.mode === 'move') {
		return {
			...crop,
			x: Math.max(0, Math.min(imageSize.width - crop.width, crop.x + event.delta.x)),
			y: Math.max(0, Math.min(imageSize.height - crop.height, crop.y + event.delta.y))
		}
	}
	return event.corner ? resizeCrop(context, crop, event.corner, event.delta.x, event.delta.y) : crop
}

export const photoCropperMachine = setup({
	types: {
		context: {} as Context,
		events: {} as CropperEvent,
		input: {} as CropperInput,
		output: {} as Output
	},
	actors: {
		decode: fromPromise(async ({ input }: { input: File }) => createImageBitmap(input)),
		crop: fromPromise(
			async ({ input }: { input: { bitmap: ImageBitmap; rect: CropRect; file: File } }) => {
				const canvas = document.createElement('canvas')
				canvas.width = Math.max(1, Math.round(input.rect.width))
				canvas.height = Math.max(1, Math.round(input.rect.height))
				try {
					const canvasContext = canvas.getContext('2d')
					if (!canvasContext) throw new Error('Canvas is unavailable')
					canvasContext.drawImage(
						input.bitmap,
						input.rect.x,
						input.rect.y,
						input.rect.width,
						input.rect.height,
						0,
						0,
						canvas.width,
						canvas.height
					)
					const blob = await new Promise<Blob>((resolve, reject) =>
						canvas.toBlob(
							(value) => (value ? resolve(value) : reject(new Error('Crop encoding failed'))),
							input.file.type
						)
					)
					return new File([blob], input.file.name, { type: blob.type || input.file.type })
				} finally {
					canvas.width = 0
					canvas.height = 0
				}
			}
		),
		closeBitmap: fromPromise(async ({ input }: { input: ImageBitmap }) => input.close())
	}
}).createMachine({
	id: 'photo-cropper',
	initial: 'loading',
	context: ({ input }) => ({
		...input,
		bitmap: undefined,
		imageSize: undefined,
		crop: undefined,
		start: undefined,
		result: undefined,
		failed: false
	}),
	output: ({ context }) => ({
		kind: context.result ? 'cropped' : 'cancelled',
		file: context.result ?? context.file
	}),
	states: {
		loading: {
			invoke: {
				src: 'decode',
				input: ({ context }) => context.file,
				onDone: [
					{
						guard: ({ context }) => Number.isFinite(context.aspectRatio) && context.aspectRatio > 0,
						target: 'ready.idle',
						actions: assign({
							bitmap: ({ event }) => event.output,
							imageSize: ({ event }) => ({
								width: event.output.width,
								height: event.output.height
							}),
							crop: ({ context, event }) =>
								initialCrop({
									...context,
									imageSize: { width: event.output.width, height: event.output.height }
								})
						})
					},
					{ target: 'failed' }
				],
				onError: { target: 'failed' }
			}
		},
		ready: {
			on: {
				CROP: 'cropping',
				CANCEL: 'closing',
				NUDGE: { actions: assign({ crop: ({ context, event }) => nudgeCrop(context, event) }) }
			},
			initial: 'idle',
			states: {
				idle: {
					on: {
						POINTER_DOWN: {
							target: 'dragging',
							actions: assign({
								start: ({ context, event }) => {
									const base = {
										x: event.point.x,
										y: event.point.y,
										crop: context.crop ?? initialCrop(context)
									}
									return event.mode === 'resize' && event.corner
										? { ...base, mode: 'resize' as const, corner: event.corner }
										: { ...base, mode: 'move' as const }
								}
							})
						}
					}
				},
				dragging: {
					on: {
						POINTER_MOVE: {
							actions: assign({ crop: ({ context, event }) => moveCrop(context, event.point) })
						},
						POINTER_UP: { target: 'idle', actions: assign({ start: undefined }) }
					}
				}
			}
		},
		cropping: {
			invoke: {
				src: 'crop',
				input: ({ context }) => {
					if (!context.bitmap || !context.crop) throw new Error('Crop resources are unavailable')
					return { bitmap: context.bitmap, rect: context.crop, file: context.file }
				},
				onDone: { target: 'closing', actions: assign({ result: ({ event }) => event.output }) },
				onError: { target: 'closing', actions: assign({ failed: true }) }
			}
		},
		closing: {
			invoke: {
				src: 'closeBitmap',
				input: ({ context }) => {
					if (!context.bitmap) throw new Error('Crop bitmap is unavailable')
					return context.bitmap
				},
				onDone: [
					{ guard: ({ context }) => context.failed, target: 'failed' },
					{ guard: ({ context }) => context.result !== undefined, target: 'cropped' },
					{ target: 'cancelled' }
				],
				onError: 'failed'
			}
		},
		cropped: { type: 'final' },
		cancelled: { type: 'final' },
		failed: { type: 'final' }
	}
})
