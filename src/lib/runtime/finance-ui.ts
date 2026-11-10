import type { NativeTextReply } from '../contracts/native-text-transfer.js'
import { getContext } from 'svelte'
import type { Readable } from 'svelte/store'
import type { RuntimeIntent, RuntimeView } from './worker/application-protocol.js'

/** Window rendering/intent surface. No SDK, actor or domain handle is exposed. */
export type FinanceUiRuntime = {
	view: Readable<RuntimeView | undefined>
	send: (intent: RuntimeIntent) => void
	exchangeText?: (
		intent: Extract<RuntimeIntent, { type: 'TRANSACTION_TEXT' | 'NAME_TEXT' }>,
		signal: AbortSignal
	) => Promise<NativeTextReply | undefined>
}
export const financeUiKey = Symbol('finance-ui-runtime')
export function getFinanceUiRuntime() {
	const runtime = getContext<FinanceUiRuntime | undefined>(financeUiKey)
	if (!runtime) throw new Error('Finance UI runtime unavailable')
	return runtime
}
