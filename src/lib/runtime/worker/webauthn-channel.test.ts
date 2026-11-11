import { afterEach, expect, it, vi } from 'vitest'
import type { WebAuthnCapability } from '../../integrations/webauthn-capability.js'
import { createWorkerWebAuthn } from './worker-webauthn.js'
import { serveWebAuthn } from './window-webauthn.js'

const cleanup: (() => void)[] = []
afterEach(() => {
	for (const close of cleanup.splice(0)) close()
})
const scope = () => crypto.randomUUID()
const input = { credentialId: 'AQID', prfSalt: 'B'.repeat(43) }
function fixture(capability: WebAuthnCapability) {
	const channel = new MessageChannel(),
		id = scope()
	const client = createWorkerWebAuthn(channel.port1, id)
	const host = serveWebAuthn(channel.port2, id, capability)
	cleanup.push(() => {
		client.close()
		host()
		channel.port1.close()
		channel.port2.close()
	})
	return { channel, client, id, host }
}
const available = (): WebAuthnCapability => ({
	create: vi.fn(async () => ({ credentialId: 'AQID', prfEnabled: true })),
	assert: vi.fn(async () => new Uint8Array(32).fill(7))
})
it('transfers PRF byte ownership privately and returns only a creation descriptor', async () => {
	const bytes = new Uint8Array(32).fill(7)
	const native = available()
	native.assert = vi.fn(async () => bytes)
	const f = fixture(native)
	const signal = new AbortController().signal
	expect(
		await f.client.capability.create({ ownerId: scope(), appName: 'Finance' }, signal)
	).toEqual({ credentialId: 'AQID', prfEnabled: true })
	const result = await f.client.capability.assert(input, signal)
	expect(result).toEqual(new Uint8Array(32).fill(7))
	expect(bytes.byteLength).toBe(0)
	result.fill(0)
})
it('cancels the exact browser prompt and waits for actual settlement', async () => {
	let settle: ((bytes: Uint8Array<ArrayBuffer>) => void) | undefined
	let nativeSignal: AbortSignal | undefined
	const native = available()
	native.assert = vi.fn(
		(_input: { credentialId: string; prfSalt: string }, signal: AbortSignal) => {
			nativeSignal = signal
			return new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
				settle = resolve
			})
		}
	)
	const f = fixture(native),
		controller = new AbortController()
	let settled = false
	const result = f.client.capability.assert(input, controller.signal)
	const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
	void result.then(
		() => {
			settled = true
		},
		() => {
			settled = true
		}
	)
	await vi.waitFor(() => expect(nativeSignal).toBeDefined())
	controller.abort()
	await vi.waitFor(() => expect(nativeSignal?.aborted).toBe(true))
	expect(settled).toBe(false)
	const bytes = new Uint8Array(32).fill(9)
	settle?.(bytes)
	await assertion
	expect(bytes.every((value) => value === 0)).toBe(true)
})
it('does not issue an already-cancelled credential prompt', async () => {
	const native = available(),
		f = fixture(native),
		controller = new AbortController()
	controller.abort()
	await expect(f.client.capability.assert(input, controller.signal)).rejects.toMatchObject({
		name: 'AbortError'
	})
	expect(native.assert).not.toHaveBeenCalled()
})
it('rejects concurrent consent without queuing another browser prompt', async () => {
	let settle: ((bytes: Uint8Array<ArrayBuffer>) => void) | undefined
	const native = available()
	native.assert = vi.fn(
		() =>
			new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
				settle = resolve
			})
	)
	const f = fixture(native),
		signal = new AbortController().signal
	const first = f.client.capability.assert(input, signal)
	await vi.waitFor(() => expect(native.assert).toHaveBeenCalledTimes(1))
	await expect(f.client.capability.assert(input, signal)).rejects.toThrow('passkey-unavailable')
	expect(native.assert).toHaveBeenCalledTimes(1)
	settle?.(new Uint8Array(32))
	await first
})
it('sanitizes native failures rather than returning extension errors or credential data', async () => {
	const native = available()
	native.assert = vi.fn(async () => {
		throw new Error('secret extension details')
	})
	const f = fixture(native)
	await expect(f.client.capability.assert(input, new AbortController().signal)).rejects.toThrow(
		/^passkey-unavailable$/
	)
})
it('ignores foreign scopes and sequence replays before invoking a credential prompt', async () => {
	const native = available(),
		f = fixture(native)
	f.channel.port1.postMessage({
		version: 1,
		type: 'WEBAUTHN_ASSERT',
		scope: scope(),
		requestId: scope(),
		sequence: 1,
		...input
	})
	await f.client.capability.assert(input, new AbortController().signal)
	f.channel.port1.postMessage({
		version: 1,
		type: 'WEBAUTHN_ASSERT',
		scope: f.id,
		requestId: scope(),
		sequence: 1,
		...input
	})
	await f.client.capability.create(
		{ ownerId: scope(), appName: 'Finance' },
		new AbortController().signal
	)
	expect(native.assert).toHaveBeenCalledTimes(1)
})
it('aborts prompts on host close and wipes a late browser result', async () => {
	let settle: ((bytes: Uint8Array<ArrayBuffer>) => void) | undefined
	let signal: AbortSignal | undefined
	const native = available()
	native.assert = vi.fn(
		(_input: { credentialId: string; prfSalt: string }, received: AbortSignal) => {
			signal = received
			return new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
				settle = resolve
			})
		}
	)
	const f = fixture(native)
	const result = f.client.capability.assert(input, new AbortController().signal)
	const assertion = expect(result).rejects.toThrow('passkey-unavailable')
	await vi.waitFor(() => expect(signal).toBeDefined())
	f.host()
	expect(signal?.aborted).toBe(true)
	const bytes = new Uint8Array(32).fill(7)
	settle?.(bytes)
	await vi.waitFor(() => expect(bytes.every((value) => value === 0)).toBe(true))
	f.client.close()
	await assertion
})
it('wipes an unmatched PRF receipt instead of retaining a stale secret', async () => {
	const f = fixture(available())
	const stale = new Uint8Array(32).fill(7)
	// No transfer here so this test can observe the rejected buffer in this realm.
	// MessagePort clones it; intercept the event to inspect that received copy.
	let observed: Uint8Array | undefined
	f.channel.port1.addEventListener('message', (event: MessageEvent<unknown>) => {
		const data = event.data
		if (data && typeof data === 'object' && 'bytes' in data && data.bytes instanceof Uint8Array)
			observed = data.bytes
	})
	f.channel.port2.postMessage({
		version: 1,
		type: 'WEBAUTHN_ASSERTED',
		scope: f.id,
		requestId: scope(),
		sequence: 1,
		bytes: stale
	})
	await vi.waitFor(() => expect(observed?.every((value) => value === 0)).toBe(true))
})

it.each([new Uint8Array(64).fill(7), new Uint8Array(64).fill(7).subarray(16, 48)])(
	'rejects a PRF result whose transfer would contain more than the selected 32 bytes',
	async (bytes) => {
		const native = available()
		native.assert = vi.fn(async () => bytes)
		const f = fixture(native)
		await expect(f.client.capability.assert(input, new AbortController().signal)).rejects.toThrow(
			'passkey-unavailable'
		)
		expect(bytes.every((value) => value === 0)).toBe(true)
	}
)
