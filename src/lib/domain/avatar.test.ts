import { afterEach, beforeEach, expect, describe, it, vi } from 'vitest'
import {
	avatarDimensions,
	decodeAvatar,
	initializeAvatarResizer,
	createAvatarCanvas,
	resizeAvatarImage,
	encodeAvatar,
	readAvatarBytes,
	releaseAvatarBitmap,
	releaseAvatarCanvas
} from './avatar.js'

const resizer = vi.hoisted(() => ({
	init: vi.fn(),
	createCanvas: vi.fn(),
	resize: vi.fn(),
	toBlob: vi.fn()
}))
vi.mock('pica', () => ({ default: () => resizer }))
beforeEach(() =>
	vi.stubGlobal(
		'OffscreenCanvas',
		class {
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
describe('avatar platform boundaries', () => {
	it.each([
		{ width: 1600, height: 800, expected: { width: 256, height: 128 } },
		{ width: 600, height: 1200, expected: { width: 128, height: 256 } },
		{ width: 64, height: 32, expected: { width: 64, height: 32 } },
		{ width: 1, height: 9999, expected: { width: 1, height: 256 } }
	])('preserves proportions without upscaling: $width × $height', (input) =>
		expect(avatarDimensions(input)).toEqual(input.expected)
	)
	it('uses EXIF-aware bitmap decoding and keeps platform calls separate', async () => {
		const bitmap = { width: 600, height: 1200, close: vi.fn() }
		const decode = vi.fn().mockResolvedValue(bitmap)
		vi.stubGlobal('createImageBitmap', decode)
		const file = new File(['image'], 'avatar.png', { type: 'image/png' })
		expect(await decodeAvatar(file)).toBe(bitmap)
		expect(decode).toHaveBeenCalledExactlyOnceWith(file, { imageOrientation: 'from-image' })
		expect(resizer.init).not.toHaveBeenCalled()
		await initializeAvatarResizer()
		expect(resizer.init).toHaveBeenCalledOnce()
		createAvatarCanvas(bitmap)
		expect(resizer.createCanvas).toHaveBeenCalledExactlyOnceWith(128, 256)
		const canvas = new OffscreenCanvas(128, 256)
		await resizeAvatarImage(bitmap, canvas)
		expect(resizer.resize).toHaveBeenCalledExactlyOnceWith(bitmap, canvas)
		const blob = new Blob(['encoded'], { type: 'image/png' })
		resizer.toBlob.mockResolvedValueOnce(blob)
		expect(await encodeAvatar(canvas)).toBe(blob)
		expect(resizer.toBlob).toHaveBeenCalledExactlyOnceWith(canvas, 'image/webp', 0.85)
		expect(await readAvatarBytes(blob)).toEqual(new TextEncoder().encode('encoded'))
		releaseAvatarBitmap(bitmap)
		expect(bitmap.close).toHaveBeenCalledOnce()
	})
	it('resets both canvas dimensions even if resetting the first throws', () => {
		const canvas = new OffscreenCanvas(256, 128)
		const setHeight = vi.fn()
		Object.defineProperty(canvas, 'width', {
			set() {
				throw new Error('Width reset failed')
			}
		})
		Object.defineProperty(canvas, 'height', { set: setHeight })
		expect(() => releaseAvatarCanvas(canvas)).toThrow('Width reset failed')
		expect(setHeight).toHaveBeenCalledExactlyOnceWith(0)
	})
})
