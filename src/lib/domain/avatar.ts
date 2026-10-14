import pica from 'pica'

const resizer = pica()
const AVATAR_MAX_DIMENSION = 256

export async function resizeAvatar(file: File): Promise<Blob> {
	const image = await createImageBitmap(file, { imageOrientation: 'from-image' })
	try {
		const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(image.width, image.height))
		const canvas = resizer.createCanvas(
			Math.max(1, Math.round(image.width * scale)),
			Math.max(1, Math.round(image.height * scale))
		)
		await resizer.resize(image, canvas)
		return await resizer.toBlob(canvas, 'image/webp', 0.85)
	} finally {
		image.close()
	}
}
