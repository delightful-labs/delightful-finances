import { afterEach, expect, it, vi } from 'vitest'
import { createNativeCapabilities } from './native-capabilities.js'
import { serveNativeCapabilities } from './native-capabilities-host.js'
import { FINANCE_RUNTIME_PROTOCOL_VERSION, runtimeCommandSchema } from './application-protocol.js'

const cleanups = new Set<() => void>()
afterEach(() => {
	for (const close of cleanups) close()
	cleanups.clear()
})
function fixture() {
	const channel = new MessageChannel(),
		scope = crypto.randomUUID()
	const navigate = vi.fn(async (_href: string, _replace: boolean) => {})
	const reload = vi.fn(),
		failed = vi.fn()
	const close = serveNativeCapabilities(channel.port2, scope, {
		readHref: () => '/current',
		readRouteSequence: () => 0,
		navigate,
		reload
	})
	const client = createNativeCapabilities(channel.port1, scope, failed)
	cleanups.add(close)
	cleanups.add(client.close)
	return { client, navigate, reload, failed }
}
it('performs only the selected same-origin navigation and reports actual completion', async () => {
	const f = fixture(),
		done = Promise.withResolvers<void>()
	f.navigate.mockImplementation(() => done.promise)
	const result = f.client.navigate('/next', '/current', true)
	await vi.waitFor(() => expect(f.navigate).toHaveBeenCalledExactlyOnceWith('/next', true))
	done.resolve()
	await result
	expect(f.failed).not.toHaveBeenCalled()
})
it('rejects obsolete route requests before invoking the browser', async () => {
	const f = fixture()
	await expect(f.client.navigate('/next', '/old')).rejects.toThrow(
		'Finance worker host unavailable'
	)
	expect(f.navigate).not.toHaveBeenCalled()
})
it('rejects external and protocol-relative navigation before native execution', async () => {
	const f = fixture()
	await expect(f.client.navigate('https://foreign.example', '/current')).rejects.toMatchObject({
		reason: 'rejected'
	})
	await expect(f.client.navigate('//foreign.example', '/current')).rejects.toMatchObject({
		reason: 'rejected'
	})
	expect(f.navigate).not.toHaveBeenCalled()
})
it('sanitizes native failure and keeps recovery distinct from a delivery receipt', async () => {
	const f = fixture()
	f.navigate.mockRejectedValue(new Error('private browser detail'))
	await expect(f.client.navigate('/next', '/current')).rejects.toMatchObject({
		message: 'Finance worker host unavailable'
	})
	expect(f.reload).not.toHaveBeenCalled()
})
it('bounds recovery inputs and refuses native capabilities on the public UI command channel', () => {
	const base = {
		version: FINANCE_RUNTIME_PROTOCOL_VERSION,
		scope: crypto.randomUUID(),
		requestId: crypto.randomUUID(),
		sequence: 1
	}
	expect(
		runtimeCommandSchema.safeParse({ ...base, type: 'NAVIGATE', destination: '/' }).success
	).toBe(false)
	expect(
		runtimeCommandSchema.safeParse({
			...base,
			type: 'APPLICATION',
			command: { type: 'RECOVER', phrase: 'x'.repeat(4097), origin: '/', destination: '/' }
		}).success
	).toBe(false)
	expect(
		runtimeCommandSchema.safeParse({
			...base,
			type: 'APPLICATION',
			command: {
				type: 'RECOVER',
				phrase: 'phrase',
				origin: '/',
				destination: 'https://foreign.example'
			}
		}).success
	).toBe(false)
})

it('rejects navigation from an earlier visit even after the same href becomes current again', async () => {
	const channel = new MessageChannel(),
		scope = crypto.randomUUID()
	let routeSequence = 0
	const navigate = vi.fn(async () => {})
	const close = serveNativeCapabilities(channel.port2, scope, {
		readHref: () => '/current',
		readRouteSequence: () => routeSequence,
		navigate,
		reload: vi.fn()
	})
	const client = createNativeCapabilities(channel.port1, scope, vi.fn())
	cleanups.add(close)
	cleanups.add(client.close)
	routeSequence = 7
	await expect(client.navigate('/next', '/current', false, 0)).rejects.toMatchObject({
		reason: 'unavailable'
	})
	expect(navigate).not.toHaveBeenCalled()
	await client.navigate('/next', '/current', false, 7)
	expect(navigate).toHaveBeenCalledOnce()
})
