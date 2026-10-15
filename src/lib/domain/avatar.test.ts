import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resizeAvatar } from './avatar.js'

const resizer = vi.hoisted(() => ({
	init: vi.fn(),
	createCanvas: vi.fn((width: number, height: number) => ({ width, height })),
	resize: vi.fn(),
	toBlob: vi.fn()
}))
vi.mock('pica', () => ({ default: () => resizer }))

beforeEach(() => {
	vi.clearAllMocks()
	resizer.init.mockResolvedValue(undefined)
	resizer.resize.mockResolvedValue(undefined)
	resizer.toBlob.mockResolvedValue(new Blob(['avatar'], { type: 'image/webp' }))
})
afterEach(() => vi.unstubAllGlobals())

describe('avatar resizing', () => {
	it.each([
		{ width: 1600, height: 800, resultWidth: 256, resultHeight: 128 },
		{ width: 600, height: 1200, resultWidth: 128, resultHeight: 256 },
		{ width: 64, height: 32, resultWidth: 64, resultHeight: 32 },
		{ width: 1, height: 9999, resultWidth: 1, resultHeight: 256 }
	])(
		'preserves proportions without upscaling: $width × $height',
		async ({ width, height, resultWidth, resultHeight }) => {
			const image = { width, height, close: vi.fn() }
			const decode = vi.fn().mockResolvedValue(image)
			vi.stubGlobal('createImageBitmap', decode)
			const file = new File(['photo'], 'photo.png', { type: 'image/png' })
			const result = await resizeAvatar(file)
			expect(decode).toHaveBeenCalledExactlyOnceWith(file, { imageOrientation: 'from-image' })
			expect(resizer.init).toHaveBeenCalledOnce()
			expect(resizer.init.mock.invocationCallOrder[0]).toBeLessThan(
				resizer.createCanvas.mock.invocationCallOrder[0] ?? 0
			)
			expect(resizer.createCanvas).toHaveBeenCalledExactlyOnceWith(resultWidth, resultHeight)
			expect(resizer.resize).toHaveBeenCalledExactlyOnceWith(image, {
				width: resultWidth,
				height: resultHeight
			})
			expect(resizer.toBlob).toHaveBeenCalledExactlyOnceWith(
				{ width: resultWidth, height: resultHeight },
				'image/webp',
				0.85
			)
			expect(result.type).toBe('image/webp')
			expect(image.close).toHaveBeenCalledOnce()
		}
	)
	it.each(['initialize', 'resize', 'encode'])(
		'releases the bitmap on %s failure',
		async (stage) => {
			const image = { width: 500, height: 500, close: vi.fn() }
			vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(image))
			const failure = new Error('Image processing failed')
			if (stage === 'initialize') resizer.init.mockRejectedValueOnce(failure)
			else if (stage === 'resize') resizer.resize.mockRejectedValueOnce(failure)
			else resizer.toBlob.mockRejectedValueOnce(failure)
			await expect(resizeAvatar(new File(['photo'], 'photo.png'))).rejects.toBe(failure)
			expect(image.close).toHaveBeenCalledOnce()
		}
	)
	it('propagates decoding failure without resizing', async () => {
		const failure = new Error('Invalid image')
		vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(failure))
		await expect(resizeAvatar(new File(['bad'], 'photo.png'))).rejects.toBe(failure)
		expect(resizer.resize).not.toHaveBeenCalled()
	})
	it('returns the actual encoder MIME type when the browser falls back', async () => {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn().mockResolvedValue({ width: 10, height: 10, close: vi.fn() })
		)
		resizer.toBlob.mockResolvedValueOnce(new Blob(['avatar'], { type: 'image/png' }))
		expect((await resizeAvatar(new File(['photo'], 'photo.png'))).type).toBe('image/png')
	})
})
