// Password-manager extensions can supply foreign-realm buffers and views.
export function byteView(value: ArrayBuffer | ArrayBufferView) {
	return ArrayBuffer.isView(value)
		? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
		: new Uint8Array(value)
}
export function encode(bytes: ArrayBuffer | Uint8Array) {
	return btoa(String.fromCharCode(...byteView(bytes)))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '')
}
export function decode(value: string) {
	return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
		c.charCodeAt(0)
	)
}
