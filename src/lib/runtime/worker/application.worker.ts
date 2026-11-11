import { bindWebAuthn } from '../../integrations/webauthn-capability.js'
import { createActor, type ActorRefFrom } from 'xstate'
import { accountRegistryUrl } from 'jazz-tools'
import { createJazzRestorationAdapter } from 'delightful-local-first/backend/jazz/restoration'
import { createJazzSessionReadinessAdapter } from 'delightful-local-first/backend/jazz/session-readiness'
import { financeWorkerRuntimeMachine } from '../../machines/runtime/finance-worker-runtime.js'
import { createApplicationReadinessMachine } from '../../machines/runtime/application-readiness.js'
import {
	createFinanceSessionAcquisition,
	loadLocalFirstClient,
	prepareLocalFirstSession
} from '../jazz-session-capabilities.js'
import { accountStorageBinding } from './account-selection.js'
import { createWorkerAccountLocks } from './worker-account-locks.js'
import { createWorkerHostClient } from './host-client.js'
import { createWorkerHostDrain } from './host-drain.js'
import { bindWorkerAccountStorage } from './account-store-storage.js'
import { createNativeCapabilities } from './native-capabilities.js'
import {
	FINANCE_RUNTIME_PROTOCOL_VERSION,
	runtimeBootstrapSchema,
	runtimeCommandSchema,
	runtimeViewSchema,
	type RuntimeBootstrap,
	type RuntimeReply,
	type RouteObservation
} from './application-protocol.js'
import { projectFinanceRuntime } from './runtime-view.js'
import { WorkerWorkspaceObservation } from './workspace-observation.js'

type Runtime = ActorRefFrom<typeof financeWorkerRuntimeMachine>
let runtime: Runtime | undefined
let scope: string | undefined
let route: RouteObservation = { pathname: '/', search: '', hash: '' }
let sequence = 0
let routeSequence = 0
let revision = 0
let awaitingRevision: number | undefined
let dirty = false
let workspace: WorkerWorkspaceObservation | undefined

function post(message: RuntimeReply) {
	self.postMessage(message)
}
function failed() {
	if (scope) post({ version: FINANCE_RUNTIME_PROTOCOL_VERSION, scope, type: 'FAILED' })
	runtime?.send({ type: 'SHUTDOWN' })
}
function href() {
	return `${route.pathname}${route.search}${route.hash}`
}
function publish() {
	if (!runtime || !scope) return
	if (awaitingRevision !== undefined) {
		dirty = true
		return
	}
	const parsed = runtimeViewSchema.safeParse(projectFinanceRuntime(runtime, workspace?.project()))
	if (!parsed.success) {
		failed()
		return
	}
	awaitingRevision = ++revision
	dirty = false
	post({
		version: FINANCE_RUNTIME_PROTOCOL_VERSION,
		scope,
		type: 'VIEW',
		revision,
		view: parsed.data
	})
}
function initialize(input: RuntimeBootstrap) {
	scope = input.scope
	route = input.route
	const applicationId = input.legacyScope || input.serverUrl.replace(/\/+$/, '')
	const binding = accountStorageBinding(
		accountRegistryUrl(input.serverUrl, applicationId),
		'dev',
		input.legacyScope
	)
	const locks = createWorkerAccountLocks(input.locks, input.scope, binding.key, failed)
	const host = createWorkerHostClient(input.storage, input.scope, failed, locks.storageLeases)
	const drain = createWorkerHostDrain(input.drain, input.scope, (scope) =>
		runtime?.send({ type: 'ACCOUNT_HOST_CLOSED', scope })
	)
	const native = createNativeCapabilities(input.native, input.scope, failed)
	const unbindWebAuthn = bindWebAuthn(native.webAuthn)
	const actor = createActor(financeWorkerRuntimeMachine, {
		input: {
			accounts: { binding, storage: bindWorkerAccountStorage(host, drain), locks: locks.locks },
			acquire: (store) =>
				createFinanceSessionAcquisition({
					serverUrl: input.serverUrl,
					...(input.legacyScope ? { scope: input.legacyScope } : {}),
					initial: 'local-first',
					client: loadLocalFirstClient,
					store,
					runtimeSources: { ...input.assets, browserWorkerHost: host.broker }
				}),
			application: (current) =>
				createApplicationReadinessMachine(
					{
						readHref: href,
						navigate: (destination) => native.navigate(destination, href(), false, routeSequence),
						reload: () => native.reload()
					},
					(session) => createJazzRestorationAdapter(session, current),
					createJazzSessionReadinessAdapter,
					{ appId: applicationId, serverUrl: input.serverUrl, environment: input.origin },
					prepareLocalFirstSession
				),
			observeApplication: (application) => {
				const observed = new WorkerWorkspaceObservation(application, {
					textScope: input.scope,
					route: () => route,
					changed: publish,
					failed,
					navigate: (destination, signal, expectedHref, replace) => {
						signal.throwIfAborted()
						if (href() !== expectedHref) return Promise.resolve()
						return native.navigate(destination, expectedHref, replace, routeSequence)
					}
				})
				workspace = observed
				return () => {
					observed.dispose()
					if (workspace === observed) workspace = undefined
				}
			},
			closeHost: drain.closeHostAndDrain,
			dispose: () => {
				unbindWebAuthn()
				native.close()
				host.close()
				drain.dispose()
				locks.dispose()
			}
		}
	})
	runtime = actor
	let application: ReturnType<Runtime['getSnapshot']>['context']['application']
	let acquisition: ReturnType<Runtime['getSnapshot']>['context']['acquisition']
	let applicationSubscription: { unsubscribe: () => void } | undefined
	let acquisitionSubscription: { unsubscribe: () => void } | undefined
	actor.subscribe({
		next(snapshot) {
			if (snapshot.context.application !== application) {
				applicationSubscription?.unsubscribe()
				application = snapshot.context.application
				applicationSubscription = application?.subscribe({ next: publish, error: failed })
			}
			if (snapshot.context.acquisition !== acquisition) {
				acquisitionSubscription?.unsubscribe()
				acquisition = snapshot.context.acquisition
				acquisitionSubscription = acquisition?.subscribe({ next: publish, error: failed })
			}
			publish()
			if (snapshot.status === 'done') {
				applicationSubscription?.unsubscribe()
				acquisitionSubscription?.unsubscribe()
				post({ version: FINANCE_RUNTIME_PROTOCOL_VERSION, scope: input.scope, type: 'CLOSED' })
			}
		},
		error: failed
	})
	actor.start()
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
	if (!runtime) {
		const decoded = runtimeBootstrapSchema.safeParse(event.data)
		if (!decoded.success) {
			for (const port of event.ports) port.close()
			return
		}
		const expected = new Set([
			decoded.data.storage,
			decoded.data.drain,
			decoded.data.locks,
			decoded.data.native
		])
		for (const port of event.ports) if (!expected.has(port)) port.close()
		initialize(decoded.data)
		return
	}
	for (const port of event.ports) port.close()
	if (event.ports.length) return
	const decoded = runtimeCommandSchema.safeParse(event.data)
	if (!decoded.success || decoded.data.scope !== scope || decoded.data.sequence !== sequence + 1)
		return
	const command = decoded.data
	sequence = command.sequence
	if (command.type !== 'ACK')
		post({
			version: FINANCE_RUNTIME_PROTOCOL_VERSION,
			scope: command.scope,
			requestId: command.requestId,
			sequence: command.sequence,
			type: 'RECEIVED'
		})
	if (command.type === 'SHUTDOWN') {
		runtime.send({ type: 'SHUTDOWN' })
		return
	}
	if (command.type === 'ACK') {
		if (command.revision !== awaitingRevision) return
		awaitingRevision = undefined
		if (dirty) publish()
		return
	}
	if (command.type === 'NAME_TEXT') {
		const reply = runtime.getSnapshot().matches('running')
			? workspace?.nameText(
					command.generation,
					command.form,
					command.draftRevision,
					command.command
				)
			: undefined
		post({
			version: FINANCE_RUNTIME_PROTOCOL_VERSION,
			scope: command.scope,
			requestId: command.requestId,
			sequence: command.sequence,
			type: 'TEXT',
			reply: reply ?? null
		})
		return
	}
	if (command.type === 'TRANSACTION_TEXT') {
		const reply = runtime.getSnapshot().matches('running')
			? workspace?.transactionText(
					command.generation,
					command.formGeneration,
					command.draftRevision,
					command.command
				)
			: undefined
		post({
			version: FINANCE_RUNTIME_PROTOCOL_VERSION,
			scope: command.scope,
			requestId: command.requestId,
			sequence: command.sequence,
			type: 'TEXT',
			reply: reply ?? null
		})
		return
	}
	if (!runtime.getSnapshot().matches('running')) return
	if (command.type === 'ROUTE') {
		route = command.route
		routeSequence = command.sequence
		workspace?.refreshRoute()
		return
	}
	if (command.type === 'TRANSACTION_EDIT') {
		workspace?.transactionEditCommand(command.generation, command.formGeneration, command.command)
		return
	}
	if (command.type === 'TRANSACTION_FORM') {
		workspace?.transactionCommand(
			command.generation,
			command.formGeneration,
			command.command,
			command.draftRevision
		)
		return
	}
	if (command.type === 'TRANSACTION_OPTIONS') {
		workspace?.transactionOptions(
			command.generation,
			command.formGeneration,
			command.catalog,
			command.offset
		)
		return
	}
	if (command.type === 'OVERVIEW') {
		workspace?.overviewCommand(command.generation, command.command)
		return
	}
	if (command.type === 'LEDGER') {
		workspace?.ledgerCommand(command.generation, command.command)
		return
	}
	if (command.type === 'MANAGEMENT_FILTER') {
		workspace?.managementFilter(command.generation, command.catalog, command.filter)
		return
	}
	if (command.type === 'MANAGEMENT_OPTIONS') {
		workspace?.managementOptions(command.generation, command.kind, command.offset)
		return
	}
	if (command.type === 'MANAGEMENT_FORM') {
		workspace?.managementCommand(
			command.generation,
			command.form,
			command.command,
			command.draftRevision
		)
		return
	}
	if (command.type === 'ACCOUNT_COMMAND') {
		workspace?.accountAction(command.generation, command.command)
		return
	}
	if (command.type === 'ACCOUNT_FORM') {
		workspace?.accountCommand(command.generation, command.command, command.draftRevision)
		return
	}
	if (command.type === 'WORKSPACE') {
		workspace?.command(command.generation, command.command)
		return
	}
	if (command.type === 'CATALOG_PAGE') {
		workspace?.page(command.generation, command.catalog, command.offset)
		return
	}
	runtime.send({ type: 'COMMAND', command: command.command })
})
