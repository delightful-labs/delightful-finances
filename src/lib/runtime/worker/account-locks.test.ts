import { afterEach, expect, it, vi } from 'vitest'
import { serveWindowAccountLocks } from './window-account-locks.js'
import { createWorkerAccountLocks } from './worker-account-locks.js'
import { serveWindowHost } from './window-host.js'
import { createWorkerHostClient } from './host-client.js'
import {
	ACCOUNT_LOCK_PROTOCOL_VERSION,
	accountLockReplySchema,
	type AccountLockRequest
} from './account-lock-protocol.js'
import { ACCOUNT_SELECTION_PREFIX } from './account-storage-namespace.js'
import { HOST_PROTOCOL_VERSION, hostReplySchema } from './host-protocol.js'

const cleanups = new Set<() => void | Promise<void>>()
afterEach(async () => {
	for (const close of cleanups) await close()
	cleanups.clear()
})
function gate() {
	const value = Promise.withResolvers<void>()
	cleanups.add(value.resolve)
	return value
}
function fixture(key: string = crypto.randomUUID()) {
	const scope = crypto.randomUUID()
	const data = new MessageChannel()
	const control = new MessageChannel()
	const binding = { key, earlierSuffix: ':dev', earlierPathname: '/old/accounts' }
	const host = serveWindowAccountLocks(control.port2, scope, binding, navigator.locks)
	const failed = vi.fn()
	const adapter = createWorkerAccountLocks(control.port1, scope, key, failed)
	const values = new Map<string, string>()
	const stopData = serveWindowHost(
		data.port2,
		{
			scope,
			accountStorageKey: key,
			accountSelection: binding,
			broker: { url: 'https://finance.example/broker.js', baseName: 'jazz-runtime:test' }
		},
		{
			origin: 'https://finance.example',
			storage: {
				getItem: (name) => values.get(name) ?? null,
				setItem: (name, value) => {
					values.set(name, value)
				}
			},
			accountLocks: host,
			openBroker: () => {
				throw new Error('unused')
			}
		}
	)
	const client = createWorkerHostClient(data.port1, scope, failed, adapter.storageLeases)
	cleanups.add(async () => {
		stopData()
		await host.close()
		adapter.dispose()
		client.close()
		host.dispose()
	})
	return { key, scope, binding, host, adapter, client, values, stopData, control, data, failed }
}

it('owns the actual native lock through the callback and acknowledges its release', async () => {
	const end = gate()
	const entered = gate()
	const f = fixture()
	const work = f.adapter.locks.request(
		f.key,
		{ signal: new AbortController().signal },
		async () => {
			entered.resolve()
			await end.promise
		}
	)
	await entered.promise
	expect(f.host.owns(f.key)).toBe(true)
	expect((await navigator.locks.query()).held?.some((lock) => lock.name === f.key)).toBe(true)
	end.resolve()
	await work
	expect(f.host.owns(f.key)).toBe(false)
	expect((await navigator.locks.query()).held?.some((lock) => lock.name === f.key)).toBe(false)
})

it('rejects writes without a Window lease and admits them only while held', async () => {
	const f = fixture()
	await expect(f.client.accountStorage.write('unlocked')).rejects.toMatchObject({
		reason: 'rejected',
		writeOutcome: 'not-issued'
	})
	await f.adapter.locks.request(f.key, { signal: new AbortController().signal }, async () => {
		await f.client.accountStorage.write('held')
	})
	expect(f.values.get(f.key)).toBe('held')
	await expect(f.client.accountStorage.write('released')).rejects.toMatchObject({
		reason: 'rejected'
	})
	expect(f.values.get(f.key)).toBe('held')
})

it('keeps a granted lock until callback settlement when its acquisition signal aborts', async () => {
	const end = gate()
	const entered = gate()
	const f = fixture()
	const abort = new AbortController()
	const work = f.adapter.locks.request(f.key, { signal: abort.signal }, async () => {
		entered.resolve()
		await end.promise
	})
	await entered.promise
	abort.abort()
	expect(f.host.owns(f.key)).toBe(true)
	end.resolve()
	await work
	expect(f.host.owns(f.key)).toBe(false)
})

it('cancels a queued native acquisition without entering the callback', async () => {
	const end = gate()
	const entered = gate()
	const f = fixture()
	const blocker = navigator.locks.request(f.key, async () => {
		entered.resolve()
		await end.promise
	})
	await entered.promise
	const abort = new AbortController()
	const callback = vi.fn(async () => {})
	const work = f.adapter.locks.request(f.key, { signal: abort.signal }, callback)
	const rejected = expect(work).rejects.toBeInstanceOf(Error)
	abort.abort()
	await rejected
	end.resolve()
	await blocker
	expect(callback).not.toHaveBeenCalled()
	expect(f.host.owns(f.key)).toBe(false)
})

it('releases a native lease after callback failure without hiding that failure', async () => {
	const f = fixture()
	await expect(
		f.adapter.locks.request(f.key, { signal: new AbortController().signal }, async () => {
			throw new Error('callback failed')
		})
	).rejects.toThrow('callback failed')
	expect(f.host.owns(f.key)).toBe(false)
})

it('retains the Window lock after worker-port disposal until data admission closes', async () => {
	const end = gate()
	const entered = gate()
	const f = fixture()
	const work = f.adapter.locks.request(
		f.key,
		{ signal: new AbortController().signal },
		async () => {
			entered.resolve()
			await end.promise
		}
	)
	const rejected = expect(work).rejects.toMatchObject({ writeOutcome: 'unknown' })
	await entered.promise
	f.adapter.dispose()
	expect(f.host.owns(f.key)).toBe(true)
	f.stopData()
	await f.host.close()
	expect(f.host.owns(f.key)).toBe(false)
	end.resolve()
	await rejected
})

it('fences an obsolete same-Window host before replacement can write', async () => {
	const end = gate()
	const entered = gate()
	const f = fixture()
	const work = f.adapter.locks.request(
		f.key,
		{ signal: new AbortController().signal },
		async () => {
			await f.client.accountStorage.write('old')
			entered.resolve()
			await end.promise
		}
	)
	await entered.promise
	const replacement = fixture(f.key)
	f.data.port2.dispatchEvent(
		new MessageEvent('message', {
			data: {
				version: HOST_PROTOCOL_VERSION,
				scope: f.scope,
				requestId: crypto.randomUUID(),
				sequence: 2,
				type: 'WRITE_ACCOUNT',
				value: 'obsolete-queued-write',
				leaseId: crypto.randomUUID()
			}
		})
	)
	await replacement.adapter.locks.request(
		f.key,
		{ signal: new AbortController().signal },
		async () => {
			await replacement.client.accountStorage.write('new')
		}
	)
	// A stale disposer cannot unregister the replacement from the fencing map.
	f.stopData()
	expect(replacement.values.get(f.key)).toBe('new')
	expect(f.values.get(f.key)).toBe('old')
	expect(f.host.owns(f.key)).toBe(false)
	end.resolve()
	await work
})

it('admits the legacy namespace lease and requires it for legacy scrubbing', async () => {
	const f = fixture()
	const key = `${ACCOUNT_SELECTION_PREFIX}${encodeURIComponent('https://old.example/old/accounts')}:dev`
	await expect(f.client.accountStorage.writeEarlier(key, 'unlocked')).rejects.toMatchObject({
		reason: 'rejected'
	})
	await f.adapter.locks.request(f.key, { signal: new AbortController().signal }, async () => {
		await f.adapter.locks.request(key, { signal: new AbortController().signal }, async () => {
			await f.client.accountStorage.writeEarlier(key, 'scrubbed')
		})
	})
	expect(f.values.get(key)).toBe('scrubbed')
	expect(f.host.owns(key)).toBe(false)
})

it('rejects a foreign namespace before acquiring a native lock', async () => {
	const f = fixture()
	const callback = vi.fn(async () => {})
	await expect(
		f.adapter.locks.request('foreign', { signal: new AbortController().signal }, callback)
	).rejects.toBeInstanceOf(Error)
	expect(callback).not.toHaveBeenCalled()
	expect(f.host.owns('foreign')).toBe(false)
})

it('rejects an old write after the same key is acquired again under a new lease', async () => {
	const f = fixture()
	let obsolete: string | undefined
	await f.adapter.locks.request(f.key, { signal: new AbortController().signal }, async () => {
		obsolete = f.adapter.storageLeases.primary()
	})
	const send = (sequence: number, leaseId: string) =>
		new Promise<unknown>((resolve) => {
			f.data.port1.addEventListener('message', (event) => resolve(event.data), { once: true })
			f.data.port1.postMessage({
				version: HOST_PROTOCOL_VERSION,
				scope: f.scope,
				requestId: crypto.randomUUID(),
				sequence,
				leaseId,
				type: 'WRITE_ACCOUNT',
				value: 'current'
			})
		})
	await f.adapter.locks.request(f.key, { signal: new AbortController().signal }, async () => {
		const current = f.adapter.storageLeases.primary()
		if (!obsolete || !current) throw new Error('Missing lease identity')
		expect(current).not.toBe(obsolete)
		expect(hostReplySchema.parse(await send(1, obsolete))).toMatchObject({
			type: 'FAILED',
			reason: 'rejected'
		})
		expect(f.values.has(f.key)).toBe(false)
		expect(hostReplySchema.parse(await send(2, current)).type).toBe('WRITTEN')
	})
	expect(f.values.get(f.key)).toBe('current')
})

it('captures namespace bindings before callers can mutate their original objects', async () => {
	const f = fixture()
	f.binding.key = 'foreign'
	await f.adapter.locks.request(f.key, { signal: new AbortController().signal }, async () => {
		await f.client.accountStorage.write('original binding')
	})
	expect(f.values.get(f.key)).toBe('original binding')
	expect(f.values.has('foreign')).toBe(false)
})

it('rejects replayed lease acquisition and release without affecting a later lease', async () => {
	const f = fixture()
	const send = (request: AccountLockRequest) =>
		new Promise<unknown>((resolve) => {
			const receive = (event: MessageEvent<unknown>) => {
				const reply = accountLockReplySchema.safeParse(event.data)
				if (!reply.success || reply.data.requestId !== request.requestId) return
				f.control.port1.removeEventListener('message', receive)
				resolve(reply.data)
			}
			f.control.port1.addEventListener('message', receive)
			f.control.port1.postMessage(request)
		})
	const first = {
		version: ACCOUNT_LOCK_PROTOCOL_VERSION,
		scope: f.scope,
		requestId: crypto.randomUUID(),
		leaseId: crypto.randomUUID(),
		sequence: 1,
		type: 'ACQUIRE',
		key: f.key
	} satisfies AccountLockRequest
	expect(await send(first)).toMatchObject({ type: 'ACQUIRED' })
	expect(await send(first)).toMatchObject({ type: 'FAILED' })
	const release = {
		...first,
		requestId: crypto.randomUUID(),
		type: 'RELEASE',
		sequence: 2
	} satisfies AccountLockRequest
	// RELEASE has no key; keep strict DTO decoding in this regression.
	const { key: _key, ...releaseDto } = release
	expect(await send(releaseDto)).toMatchObject({ type: 'RELEASED' })
	expect(await send(first)).toMatchObject({ type: 'FAILED' })
	const replacement = {
		...first,
		requestId: crypto.randomUUID(),
		leaseId: crypto.randomUUID(),
		sequence: 3
	}
	expect(await send(replacement)).toMatchObject({ type: 'ACQUIRED' })
	expect(await send(releaseDto)).toMatchObject({ type: 'FAILED' })
	expect(f.host.owns(f.key, replacement.leaseId)).toBe(true)
	expect(
		await send({
			...releaseDto,
			requestId: crypto.randomUUID(),
			leaseId: replacement.leaseId,
			sequence: 4
		})
	).toMatchObject({ type: 'RELEASED' })
})

it('ignores an obsolete scope and transferred handles on the lock capability port', async () => {
	const f = fixture()
	f.control.port2.dispatchEvent(
		new MessageEvent('message', {
			data: {
				version: ACCOUNT_LOCK_PROTOCOL_VERSION,
				sequence: 1,
				scope: crypto.randomUUID(),
				requestId: crypto.randomUUID(),
				leaseId: crypto.randomUUID(),
				type: 'ACQUIRE',
				key: f.key
			}
		})
	)
	expect(f.host.owns(f.key)).toBe(false)
	await f.adapter.locks.request(f.key, { signal: new AbortController().signal }, async () => {
		expect(f.host.owns(f.key)).toBe(true)
	})
})
