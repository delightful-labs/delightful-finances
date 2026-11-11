import type { NativeTextReply } from '../../contracts/native-text-transfer.js'
import { accountRegistryUrl } from 'jazz-tools'
import { accountStorageBinding } from './account-selection.js'
import { serveWindowAccountLocks } from './window-account-locks.js'
import { serveWindowHost } from './window-host.js'
import { serveWindowHostDrain } from './host-drain.js'
import { serveNativeCapabilities } from './native-capabilities-host.js'
import { financeRuntimeAssets } from './runtime-assets.js'
import {
	FINANCE_RUNTIME_PROTOCOL_VERSION,
	MAX_RUNTIME_COMMANDS,
	runtimeCommandSchema,
	runtimeReplySchema,
	type RuntimeBootstrap,
	type RuntimeIntent,
	type RouteObservation
} from './application-protocol.js'
import type {
	WindowRuntimeConnection,
	WindowRuntimeReport
} from '../../machines/runtime/window-runtime.js'

export type WindowRuntimeOptions = {
	serverUrl: string
	legacyScope?: string
	route: RouteObservation
	readHref: () => string
	navigate: (destination: string, replace: boolean) => Promise<void>
	reload: () => void
}
/** Opaque native connection. Lifecycle belongs to windowRuntimeMachine; callers
 * cannot mistake this transport's error or delivery acknowledgement for a save. */
export class FinanceWindowConnection implements WindowRuntimeConnection {
	readonly scope = crypto.randomUUID()
	private readonly worker: Worker
	private readonly storage = new MessageChannel()
	private readonly drain = new MessageChannel()
	private readonly locks = new MessageChannel()
	private readonly native = new MessageChannel()
	private readonly nativeLocks: ReturnType<typeof serveWindowAccountLocks>
	private readonly closeHost: () => void
	private readonly closeDrain: () => void
	private readonly closeNative: () => void
	private readonly bootstrap: RuntimeBootstrap
	private readonly observers = new Set<(report: WindowRuntimeReport) => void>()
	private readonly pending = new Map<
		string,
		{ sequence: number; timer: ReturnType<typeof setTimeout> }
	>()
	private readonly textWaiters = new Map<
		string,
		{ sequence: number; finish: (reply: NativeTextReply | undefined) => void }
	>()
	private sequence = 0
	private revision = 0
	private routeSequence = 0
	private started = false
	private disposed = false
	private startupTimer: ReturnType<typeof setTimeout> | undefined

	constructor(options: WindowRuntimeOptions) {
		const serverUrl = new URL(options.serverUrl, location.origin).href
		const legacyScope = options.legacyScope?.trim()
		const binding = accountStorageBinding(
			accountRegistryUrl(serverUrl, legacyScope || serverUrl.replace(/\/+$/, '')),
			'dev',
			legacyScope
		)
		const assets = financeRuntimeAssets(location.origin)
		this.nativeLocks = serveWindowAccountLocks(
			this.locks.port2,
			this.scope,
			binding,
			navigator.locks
		)
		this.closeHost = serveWindowHost(
			this.storage.port2,
			{
				scope: this.scope,
				accountStorageKey: binding.key,
				accountSelection: binding,
				broker: { url: assets.brokerWorkerUrl, source: 'sdk' }
			},
			{
				origin: location.origin,
				storage: localStorage,
				inventory: localStorage,
				accountLocks: this.nativeLocks,
				openBroker: (url, name) => new SharedWorker(url, { type: 'module', name })
			}
		)
		this.closeDrain = serveWindowHostDrain(this.drain.port2, this.scope, this.closeHost)
		this.closeNative = serveNativeCapabilities(this.native.port2, this.scope, {
			...options,
			readRouteSequence: () => this.routeSequence
		})
		this.worker = new Worker(new URL('./application.worker.ts', import.meta.url), {
			type: 'module'
		})
		this.worker.addEventListener('message', this.receive)
		this.worker.addEventListener('error', this.fail)
		this.worker.addEventListener('messageerror', this.fail)
		this.bootstrap = {
			version: FINANCE_RUNTIME_PROTOCOL_VERSION,
			type: 'INITIALIZE',
			scope: this.scope,
			origin: location.origin,
			serverUrl,
			...(legacyScope ? { legacyScope } : {}),
			route: options.route,
			assets,
			storage: this.storage.port1,
			drain: this.drain.port1,
			locks: this.locks.port1,
			native: this.native.port1
		}
	}
	private emit(report: WindowRuntimeReport) {
		for (const observer of this.observers) observer(report)
	}
	private fail = () => {
		if (!this.disposed) {
			for (const waiter of this.textWaiters.values()) waiter.finish(undefined)
			this.emit({ type: 'FAILED' })
		}
	}
	private receive = (event: MessageEvent<unknown>) => {
		for (const port of event.ports) port.close()
		if (this.disposed || event.ports.length) return
		const decoded = runtimeReplySchema.safeParse(event.data)
		if (!decoded.success || decoded.data.scope !== this.scope) return
		const message = decoded.data
		if (message.type === 'TEXT') {
			const waiter = this.textWaiters.get(message.requestId)
			if (waiter?.sequence === message.sequence) waiter.finish(message.reply ?? undefined)
			return
		}
		if (message.type === 'RECEIVED') {
			const pending = this.pending.get(message.requestId)
			if (pending?.sequence !== message.sequence) return
			clearTimeout(pending.timer)
			this.pending.delete(message.requestId)
			return
		}
		if (message.type === 'VIEW') {
			if (message.revision <= this.revision) return
			this.revision = message.revision
			clearTimeout(this.startupTimer)
			try {
				this.emit({ type: 'VIEW', view: message.view })
			} finally {
				this.send({ type: 'ACK', revision: message.revision })
			}
			return
		}
		if (message.type === 'CLOSED') {
			for (const waiter of this.textWaiters.values()) waiter.finish(undefined)
			clearTimeout(this.startupTimer)
			for (const pending of this.pending.values()) clearTimeout(pending.timer)
			this.pending.clear()
			this.emit({ type: 'CLOSED' })
			return
		}
		this.fail()
	}
	subscribe = (observer: (report: WindowRuntimeReport) => void) => {
		this.observers.add(observer)
		return () => {
			this.observers.delete(observer)
		}
	}
	start = () => {
		if (this.started || this.disposed) throw new Error('Finance runtime already initialized')
		this.started = true
		this.startupTimer = setTimeout(this.fail, 30_000)
		this.worker.postMessage(this.bootstrap, [
			this.storage.port1,
			this.drain.port1,
			this.locks.port1,
			this.native.port1
		])
	}
	send = (command: RuntimeIntent, requestId = crypto.randomUUID()) => {
		if (this.disposed || !this.started || this.pending.size >= MAX_RUNTIME_COMMANDS) {
			this.fail()
			return
		}
		const decoded = runtimeCommandSchema.safeParse({
			...command,
			version: FINANCE_RUNTIME_PROTOCOL_VERSION,
			scope: this.scope,
			requestId,
			sequence: this.sequence + 1
		})
		if (!decoded.success) {
			this.fail()
			return
		}
		const message = decoded.data
		if (message.type !== 'ACK')
			this.pending.set(message.requestId, {
				sequence: message.sequence,
				timer: setTimeout(this.fail, 10_000)
			})
		try {
			if (message.type === 'ROUTE') this.routeSequence = message.sequence
			this.worker.postMessage(message)
			this.sequence = message.sequence
		} catch {
			this.fail()
		}
	}
	/** One bounded native text frame. The caller's I/O actor owns sequencing. */
	exchangeText = (
		command: Extract<RuntimeIntent, { type: 'TRANSACTION_TEXT' | 'NAME_TEXT' }>,
		signal: AbortSignal
	): Promise<NativeTextReply | undefined> =>
		new Promise((resolve) => {
			if (
				signal.aborted ||
				this.disposed ||
				!this.started ||
				this.textWaiters.size >= MAX_RUNTIME_COMMANDS
			) {
				resolve(undefined)
				return
			}
			const requestId = crypto.randomUUID()
			const finish = (reply: NativeTextReply | undefined) => {
				if (!this.textWaiters.delete(requestId)) return
				clearTimeout(timer)
				signal.removeEventListener('abort', abort)
				resolve(reply)
			}
			const abort = () => finish(undefined)
			const timer = setTimeout(abort, 10000)
			this.textWaiters.set(requestId, { sequence: this.sequence + 1, finish })
			signal.addEventListener('abort', abort, { once: true })
			this.send(command, requestId)
		})
	requestShutdown = () => this.send({ type: 'SHUTDOWN' })
	closeData = () => {
		for (const waiter of this.textWaiters.values()) waiter.finish(undefined)
		this.closeHost()
	}
	drainNativeLocks = () => this.nativeLocks.close()
	dispose = () => {
		if (this.disposed) return
		this.disposed = true
		for (const waiter of this.textWaiters.values()) waiter.finish(undefined)
		clearTimeout(this.startupTimer)
		for (const pending of this.pending.values()) clearTimeout(pending.timer)
		this.pending.clear()
		this.nativeLocks.dispose()
		this.closeHost()
		this.closeDrain()
		this.closeNative()
		this.worker.removeEventListener('message', this.receive)
		this.worker.removeEventListener('error', this.fail)
		this.worker.removeEventListener('messageerror', this.fail)
		this.worker.terminate()
		this.observers.clear()
	}
}
