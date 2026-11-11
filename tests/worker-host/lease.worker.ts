import { z } from 'zod'
import { createWorkerAccountLocks } from '../../src/lib/runtime/worker/worker-account-locks.js'
import { createWorkerHostClient } from '../../src/lib/runtime/worker/host-client.js'

const bootstrap = z
	.object({
		type: z.literal('START'),
		scope: z.string().uuid(),
		key: z.string(),
		value: z.string(),
		locks: z.instanceof(MessagePort),
		data: z.instanceof(MessagePort)
	})
	.strict()
self.addEventListener('message', (event: MessageEvent<unknown>) => {
	const parsed = bootstrap.safeParse(event.data)
	if (!parsed.success) return
	const input = parsed.data
	const failure = () => self.postMessage({ type: 'FAILED' })
	const adapter = createWorkerAccountLocks(input.locks, input.scope, input.key, failure)
	const client = createWorkerHostClient(input.data, input.scope, failure, adapter.storageLeases)
	const release = Promise.withResolvers<void>()
	self.addEventListener('message', (event: MessageEvent<unknown>) => {
		if (
			z
				.object({ type: z.literal('RELEASE') })
				.strict()
				.safeParse(event.data).success
		)
			release.resolve()
	})
	void adapter.locks
		.request(input.key, { signal: new AbortController().signal }, async () => {
			self.postMessage({ type: 'LOCKED' })
			await client.accountStorage.write(input.value)
			self.postMessage({ type: 'WRITTEN' })
			await release.promise
		})
		.then(() => {
			client.close()
			adapter.dispose()
			self.postMessage({ type: 'RELEASED' })
		}, failure)
})
