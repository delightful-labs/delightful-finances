import wasm from '#jazz-wasm-binary?url'
import broker from '#jazz-broker-entry?worker&url'

// Changes with the vendored SDK patch; both realms receive these exact URLs.
export const FINANCE_JAZZ_RUNTIME_VERSION = 'finance-alpha60-c8b3fbdc'
export function financeRuntimeAssets(origin: string) {
	const wasmUrl = new URL(wasm, origin)
	const brokerWorkerUrl = new URL(broker, origin)
	wasmUrl.searchParams.set('jazz-runtime-version', FINANCE_JAZZ_RUNTIME_VERSION)
	brokerWorkerUrl.searchParams.set('jazz-runtime-version', FINANCE_JAZZ_RUNTIME_VERSION)
	return {
		wasmUrl: wasmUrl.href,
		brokerWorkerUrl: brokerWorkerUrl.href,
		wasmVersion: FINANCE_JAZZ_RUNTIME_VERSION
	}
}
