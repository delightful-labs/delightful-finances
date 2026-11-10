import { expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { WindowRuntimeReport } from '../../machines/runtime/window-runtime.js'
import { createFinanceWindowRuntime } from './window-runtime-facade.js'
import type { RuntimeView } from './application-protocol.js'
import { emptyWorkspaceView } from './workspace-protocol.js'

it('closes UI admission on failure while retaining the worker until actual native drain', async () => {
	let publish: ((report: WindowRuntimeReport) => void) | undefined
	const drain = Promise.withResolvers<void>()
	const connection = {
		start: vi.fn(),
		requestShutdown: vi.fn(),
		closeData: vi.fn(),
		dispose: vi.fn(),
		drainNativeLocks: vi.fn(() => drain.promise),
		send: vi.fn(),
		exchangeText: vi.fn(async () => undefined),
		subscribe: (listener: (report: WindowRuntimeReport) => void) => {
			publish = listener
			return () => {
				publish = undefined
			}
		}
	}
	const runtime = createFinanceWindowRuntime(connection)
	await vi.waitFor(() => expect(runtime.state()).toBe('running'))
	expect(get(runtime.lifecycle)).toBe('running')
	const view: RuntimeView = {
		workspace: emptyWorkspaceView(),
		runtime: 'running',
		session: { status: 'ready', identityId: null },
		startup: { failed: false, waitingForOtherVersion: false },
		recovery: {
			busy: false,
			navigationOnly: false,
			invalid: false,
			failed: false,
			navigationFailed: false,
			canRetryNavigation: false,
			draftRevision: 0
		}
	}
	publish?.({ type: 'VIEW', view })
	expect(get(runtime.context.view)).toEqual(view)
	runtime.context.send({ type: 'APPLICATION', command: { type: 'RETRY' } })
	expect(connection.send).toHaveBeenCalledOnce()
	const textIntent = {
		type: 'TRANSACTION_TEXT',
		generation: 1,
		formGeneration: 1,
		draftRevision: 0,
		command: { type: 'READ', requestId: '550e8400-e29b-41d4-a716-446655440000', field: 'memo' }
	} satisfies import('./application-protocol.js').RuntimeIntent
	const signal = new AbortController().signal
	await runtime.context.exchangeText?.(textIntent, signal)
	expect(connection.exchangeText).toHaveBeenCalledOnce()
	publish?.({ type: 'FAILED' })
	expect(get(runtime.lifecycle)).toBe('blocked')
	expect(get(runtime.context.view)).toBeUndefined()
	expect(await runtime.context.exchangeText?.(textIntent, signal)).toBeUndefined()
	expect(connection.exchangeText).toHaveBeenCalledOnce()
	publish?.({ type: 'VIEW', view })
	expect(get(runtime.context.view)).toBeUndefined()
	runtime.context.send({ type: 'APPLICATION', command: { type: 'RETRY' } })
	expect(connection.send).toHaveBeenCalledOnce()
	expect(connection.dispose).not.toHaveBeenCalled()
	publish?.({ type: 'CLOSED' })
	await vi.waitFor(() => expect(connection.drainNativeLocks).toHaveBeenCalledOnce())
	expect(connection.dispose).not.toHaveBeenCalled()
	drain.resolve()
	await runtime.close()
	expect(connection.dispose).toHaveBeenCalledOnce()
	expect(get(runtime.lifecycle)).toBe('closed')
})
