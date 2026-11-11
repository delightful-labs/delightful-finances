import { createActor, toPromise } from 'xstate'
import { readable } from 'svelte/store'
import {
	windowRuntimeMachine,
	type WindowRuntimeConnection
} from '../../machines/runtime/window-runtime.js'
import type { FinanceUiRuntime } from '../finance-ui.js'
import type { RuntimeIntent, RuntimeView } from './application-protocol.js'

/** The Window runtime chart owns native lifecycle, never finance workflows. */
export function createFinanceWindowRuntime(
	connection: WindowRuntimeConnection & {
		send: (intent: RuntimeIntent) => void
		exchangeText?: FinanceUiRuntime['exchangeText']
	}
) {
	const owner = createActor(windowRuntimeMachine, { input: connection }).start()
	function projectedView() {
		const snapshot = owner.getSnapshot()
		return snapshot.matches('running') ? snapshot.context.view : undefined
	}
	const view = readable<RuntimeView | undefined>(projectedView(), (set) => {
		set(projectedView())
		const subscription = owner.subscribe(() => set(projectedView()))
		return () => subscription.unsubscribe()
	})
	type Lifecycle = 'starting' | 'running' | 'draining' | 'blocked' | 'closed'
	function projectedLifecycle(): Lifecycle {
		const snapshot = owner.getSnapshot()
		return snapshot.matches('releaseBlocked')
			? 'blocked'
			: snapshot.matches('closed')
				? 'closed'
				: snapshot.matches('running')
					? 'running'
					: snapshot.matches('starting')
						? 'starting'
						: 'draining'
	}
	const lifecycle = readable<Lifecycle>(projectedLifecycle(), (set) => {
		set(projectedLifecycle())
		const subscription = owner.subscribe(() => set(projectedLifecycle()))
		return () => subscription.unsubscribe()
	})

	const context: FinanceUiRuntime = {
		view,
		exchangeText: (intent, signal) =>
			owner.getSnapshot().matches('running') && connection.exchangeText
				? connection.exchangeText(intent, signal)
				: Promise.resolve(undefined),
		send: (intent) => {
			if (owner.getSnapshot().matches('running')) connection.send(intent)
		}
	}
	return {
		context,
		lifecycle,
		state: () => owner.getSnapshot().value,
		async close() {
			owner.send({ type: 'CLOSE' })
			await toPromise(owner)
		}
	}
}
