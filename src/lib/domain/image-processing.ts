import { Pica, type PicaCanvas } from 'pica'

/** Pica's scratch allocations omit preferOffscreen on some resize paths.
 * Bind its public canvas factory to the current realm, including those calls. */
class FinanceImageResizer extends Pica {
	override createCanvas(
		width: number,
		height: number,
		preference?: { preferOffscreen?: boolean }
	): PicaCanvas {
		return 'document' in globalThis
			? super.createCanvas(width, height, preference)
			: new OffscreenCanvas(width, height)
	}
}
const resizer = new FinanceImageResizer({
	features: 'document' in globalThis ? ['js', 'wasm', 'ww'] : ['js', 'wasm']
})

export type ImageDimensions = { width: number; height: number }
export type ImageProcessingOptions = {
	maxWidth: number
	maxHeight: number
	mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
	quality?: number
}

export function decodeImage(file: Blob) {
	return createImageBitmap(file, { imageOrientation: 'from-image' })
}

export async function initializeImageResizer(): Promise<void> {
	await resizer.init()
}

export function fitImageDimensions(
	image: ImageDimensions,
	max: Pick<ImageProcessingOptions, 'maxWidth' | 'maxHeight'>
): ImageDimensions {
	const scale = Math.min(1, max.maxWidth / image.width, max.maxHeight / image.height)
	return {
		width: Math.max(1, Math.round(image.width * scale)),
		height: Math.max(1, Math.round(image.height * scale))
	}
}

export function createImageCanvas(image: ImageBitmap, options: ImageProcessingOptions) {
	const { width, height } = fitImageDimensions(image, options)
	return resizer.createCanvas(width, height, { preferOffscreen: true })
}

export function resizeImage(image: ImageBitmap, canvas: PicaCanvas) {
	return resizer.resize(image, canvas)
}

export function encodeImage(
	canvas: PicaCanvas,
	options: ImageProcessingOptions
): Promise<Blob | null> {
	if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
		return canvas.convertToBlob({
			type: options.mimeType,
			...(options.quality === undefined ? {} : { quality: options.quality })
		})
	}
	return resizer.toBlob(canvas, options.mimeType, options.quality)
}

export async function readImageBytes(blob: Blob) {
	return new Uint8Array(await blob.arrayBuffer())
}

export function releaseImageBitmap(image: ImageBitmap) {
	image.close()
}

export function releaseImageCanvas(canvas: PicaCanvas) {
	try {
		canvas.width = 0
	} finally {
		canvas.height = 0
	}
}
