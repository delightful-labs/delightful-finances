/** Minimal native pixel-buffer stand-in for Node; tests exercise the real pixel math. */
export class TestImageData implements ImageData {
	readonly colorSpace: PredefinedColorSpace = 'srgb'
	readonly data: Uint8ClampedArray<ArrayBuffer>
	constructor(
		public readonly width: number,
		public readonly height: number,
		values?: readonly number[]
	) {
		this.data = new Uint8ClampedArray(width * height * 4)
		if (values) this.data.set(values)
	}
}
