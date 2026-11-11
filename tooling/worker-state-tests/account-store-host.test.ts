import { afterEach, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { accountStoreOwnerMachine } from '../../src/lib/machines/runtime/account-store-owner.js'
import { createWorkerAccountStore } from '../../src/lib/runtime/worker/account-store-facade.js'
import { bindWorkerAccountStorage } from '../../src/lib/runtime/worker/account-store-storage.js'
import { serveWindowHost } from '../../src/lib/runtime/worker/window-host.js'
import {
	serveWindowHostDrain,
	createWorkerHostDrain
} from '../../src/lib/runtime/worker/host-drain.js'
import { createWorkerHostClient } from '../../src/lib/runtime/worker/host-client.js'
import { serveWindowAccountLocks } from '../../src/lib/runtime/worker/window-account-locks.js'
import { createWorkerAccountLocks } from '../../src/lib/runtime/worker/worker-account-locks.js'
import { accountStorageBinding } from '../../src/lib/runtime/worker/account-selection.js'
import { roots, selection } from './account-store.test-support.js'

const cleanups = new Set<() => Promise<void>>()
afterEach(async () => {
	for (const close of cleanups) await close()
	cleanups.clear()
})

function fixture() {
	const scope = crypto.randomUUID()
	const binding = accountStorageBinding(
		'https://finance.example/jazz/accounts',
		crypto.randomUUID()
	)
	const data = new MessageChannel()
	const control = new MessageChannel()
	const locks = new MessageChannel()
	const nativeLocks = serveWindowAccountLocks(locks.port2, scope, binding, navigator.locks)
	const remoteLocks = createWorkerAccountLocks(locks.port1, scope, binding.key, () => {})
	const values = new Map<string, string>()
	const setItem = vi.fn((key: string, value: string) => {
		values.set(key, value)
	})
	const closeData = serveWindowHost(
		data.port2,
		{
			scope,
			accountStorageKey: binding.key,
			accountSelection: binding,
			broker: { url: 'https://finance.example/broker.js', baseName: 'jazz-runtime:host-test' }
		},
		{
			origin: 'https://finance.example',
			storage: { getItem: (key) => values.get(key) ?? null, setItem },
			accountLocks: nativeLocks,
			openBroker: () => {
				throw new Error('unused')
			}
		}
	)
	const closeControl = serveWindowHostDrain(control.port2, scope, closeData)
	const client = createWorkerHostClient(data.port1, scope, () => {}, remoteLocks.storageLeases)
	const drain = createWorkerHostDrain(control.port1, scope, (scope) =>
		owner.send({ type: 'HOST_CLOSED', scope })
	)
	const owner = createActor(accountStoreOwnerMachine, {
		input: { binding, storage: bindWorkerAccountStorage(client, drain), locks: remoteLocks.locks }
	}).start()
	const store = createWorkerAccountStore(owner)
	cleanups.add(async () => {
		owner.send({ type: 'SHUTDOWN' })
		closeData()
		await nativeLocks.close()
		owner.send({ type: 'HOST_CLOSED', scope })
		await toPromise(owner)
		remoteLocks.dispose()
		nativeLocks.dispose()
		client.close()
		drain.dispose()
		closeControl()
	})
	return { scope, binding, values, store, owner, nativeLocks, setItem }
}

it('runs the SDK account-store chart through native Window lock and storage receipts', async () => {
	const f = fixture()
	expect(await f.store.read()).toBeNull()
	await f.store.update((previous) => {
		expect(previous).toBeNull()
		expect(f.nativeLocks.owns(f.binding.key)).toBe(true)
		return selection([roots[0]!])
	})
	expect(await f.store.read()).toBe(selection([roots[0]!]))
	expect(f.nativeLocks.owns(f.binding.key)).toBe(false)
	f.owner.send({ type: 'SHUTDOWN' })
	await toPromise(f.owner)
})

it('serializes transformations against acknowledged storage through the remote lease', async () => {
	const f = fixture()
	const observed: (string | null)[] = []
	await Promise.all(
		[roots[0]!, roots[1]!, roots[2]!].map((root) =>
			f.store.update((previous) => {
				observed.push(previous)
				return selection([root])
			})
		)
	)
	expect(observed).toEqual([null, selection([roots[0]!]), selection([roots[1]!])])
	expect(f.values.get(f.binding.key)).toBe(selection([roots[2]!]))
	expect(f.setItem).toHaveBeenCalledTimes(3)
	expect(f.nativeLocks.owns(f.binding.key)).toBe(false)
})

it('drains Window before releasing an unknown native write and preserves the actual written value', async () => {
	const f = fixture()
	f.setItem.mockImplementation((key, value) => {
		f.values.set(key, value)
		throw new Error('lost native acknowledgement')
	})
	await expect(f.store.update(() => selection([roots[0]!]))).rejects.toMatchObject({
		writeOutcome: 'unknown'
	})
	await toPromise(f.owner)
	expect(f.values.get(f.binding.key)).toBe(selection([roots[0]!]))
	expect(f.setItem).toHaveBeenCalledOnce()
	expect(f.nativeLocks.owns(f.binding.key)).toBe(false)
	await expect(f.store.read()).rejects.toMatchObject({ reason: 'closed' })
})
