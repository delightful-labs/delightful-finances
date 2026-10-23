import pica, { type PicaCanvas } from 'pica'

const resizer = pica()
const AVATAR_MAX_DIMENSION = 256

export function decodeAvatar(file: File) {
	return createImageBitmap(file, { imageOrientation: 'from-image' })
}
export function initializeAvatarResizer() {
	return resizer.init()
}
export function avatarDimensions(image: Pick<ImageBitmap, 'width' | 'height'>) {
	const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(image.width, image.height))
	return {
		width: Math.max(1, Math.round(image.width * scale)),
		height: Math.max(1, Math.round(image.height * scale))
	}
}
export function createAvatarCanvas(image: ImageBitmap) {
	const { width, height } = avatarDimensions(image)
	return resizer.createCanvas(width, height)
}
export function resizeAvatarImage(image: ImageBitmap, canvas: PicaCanvas) {
	return resizer.resize(image, canvas)
}
export function encodeAvatar(canvas: PicaCanvas): Promise<Blob | null> {
	return resizer.toBlob(canvas, 'image/webp', 0.85)
}
export async function readAvatarBytes(blob: Blob) {
	return new Uint8Array(await blob.arrayBuffer())
}
export function releaseAvatarBitmap(image: ImageBitmap) {
	image.close()
}
export function releaseAvatarCanvas(canvas: PicaCanvas) {
	try {
		canvas.width = 0
	} finally {
		canvas.height = 0
	}
}
