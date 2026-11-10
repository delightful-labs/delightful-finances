import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	createImageCanvas,
	decodeImage,
	encodeImage,
	fitImageDimensions,
	initializeImageResizer,
	readImageBytes,
	releaseImageBitmap,
	releaseImageCanvas,
	resizeImage
} from './image-processing.js'

const convertToBlob = vi.fn()
const resizer = vi.hoisted(() => ({
	init: vi.fn(),
	createCanvas: vi.fn(),
	resize: vi.fn(),
	toBlob: vi.fn()
}))
vi.mock('pica', () => ({
	Pica: class {
		init = resizer.init
		resize = resizer.resize
		toBlob = resizer.toBlob
		createCanvas(width: number, height: number, preference?: { preferOffscreen?: boolean }) {
			return resizer.createCanvas(width, height, preference)
		}
	}
}))

beforeEach(() =>
	vi.stubGlobal(
		'OffscreenCanvas',
		class {
			convertToBlob = convertToBlob
			constructor(
				public width: number,
				public height: number
			) {}
		}
	)
)
afterEach(() => {
	vi.clearAllMocks()
	vi.unstubAllGlobals()
})

describe('shared image processing platform', () => {
	it.each([
		{
			width: 1600,
			height: 800,
			maxWidth: 256,
			maxHeight: 256,
			expected: { width: 256, height: 128 }
		},
		{
			width: 600,
			height: 1200,
			maxWidth: 256,
			maxHeight: 256,
			expected: { width: 128, height: 256 }
		},
		{
			width: 4000,
			height: 1000,
			maxWidth: 2048,
			maxHeight: 2048,
			expected: { width: 2048, height: 512 }
		},
		{ width: 64, height: 32, maxWidth: 256, maxHeight: 256, expected: { width: 64, height: 32 } }
	])(
		'fits proportionally without upscaling: $width × $height',
		({ width, height, maxWidth, maxHeight, expected }) =>
			expect(fitImageDimensions({ width, height }, { maxWidth, maxHeight })).toEqual(expected)
	)

	it('keeps browser and encoder operations as separate platform boundaries', async () => {
		const bitmap = { width: 600, height: 1200, close: vi.fn() }
		const decode = vi.fn().mockResolvedValue(bitmap)
		vi.stubGlobal('createImageBitmap', decode)
		const file = new File(['image'], 'avatar.png', { type: 'image/png' })
		expect(await decodeImage(file)).toBe(bitmap)
		expect(decode).toHaveBeenCalledExactlyOnceWith(file, { imageOrientation: 'from-image' })

		await initializeImageResizer()
		expect(resizer.init).toHaveBeenCalledOnce()
		const options = {
			maxWidth: 256,
			maxHeight: 256,
			mimeType: 'image/webp' as const,
			quality: 0.85
		}
		const canvas = createImageCanvas(bitmap, options)
		expect(canvas).toBeInstanceOf(OffscreenCanvas)
		expect(canvas.width).toBe(128)
		expect(canvas.height).toBe(256)
		expect(resizer.createCanvas).not.toHaveBeenCalled()
		await resizeImage(bitmap, canvas)
		expect(resizer.resize).toHaveBeenCalledExactlyOnceWith(bitmap, canvas)
		const blob = new Blob(['encoded'], { type: 'image/webp' })
		convertToBlob.mockResolvedValueOnce(blob)
		expect(await encodeImage(canvas, options)).toBe(blob)
		expect(convertToBlob).toHaveBeenCalledExactlyOnceWith({ type: 'image/webp', quality: 0.85 })
		expect(resizer.toBlob).not.toHaveBeenCalled()
		expect(await readImageBytes(blob)).toEqual(new TextEncoder().encode('encoded'))
		releaseImageBitmap(bitmap)
		expect(bitmap.close).toHaveBeenCalledOnce()
	})

	it('resets both canvas dimensions even if resetting width throws', () => {
		const canvas = new OffscreenCanvas(256, 128)
		const setHeight = vi.fn()
		Object.defineProperty(canvas, 'width', {
			set() {
				throw new Error('Width reset failed')
			}
		})
		Object.defineProperty(canvas, 'height', { set: setHeight })
		expect(() => releaseImageCanvas(canvas)).toThrow('Width reset failed')
		expect(setHeight).toHaveBeenCalledExactlyOnceWith(0)
	})
})
