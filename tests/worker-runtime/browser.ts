import WorkerTransactionEntry from '../../src/lib/components/transactions/WorkerTransactionEntry.svelte'
import type {
	TransactionRouteIntent,
	TransactionEditIntent
} from '../../src/lib/runtime/worker/transaction-route-protocol.js'
import WorkerOverview from '../../src/lib/components/reports/WorkerOverview.svelte'
import type { OverviewCommand } from '../../src/lib/runtime/worker/overview-protocol.js'
import WorkerLedger from '../../src/lib/components/transactions/WorkerLedger.svelte'
import type { LedgerCommand } from '../../src/lib/runtime/worker/ledger-protocol.js'
import WorkerClassification from '../../src/lib/components/classification/WorkerClassification.svelte'
import type { WorkspaceCommand } from '../../src/lib/runtime/worker/workspace-protocol.js'
import 'delightful-ui/theme.css'
import type { AccountFormIntent } from '../../src/lib/runtime/worker/form-protocol.js'
import { get } from 'svelte/store'
import { mount, unmount } from 'svelte'
import WorkerAccounts from '../../src/lib/components/accounts/WorkerAccounts.svelte'
import { createFinanceWindowRuntime } from '../../src/lib/runtime/worker/window-runtime-facade.js'
import { FinanceWindowConnection } from '../../src/lib/runtime/worker/window-runtime-connection.js'

function harness() {
	let imageReports: unknown[] = []
	let transport: FinanceWindowConnection | undefined
	let owner: ReturnType<typeof createFinanceWindowRuntime> | undefined
	let overviewUi: ReturnType<typeof mount> | undefined
	let overviewSection: HTMLElement | undefined
	let ledgerUi: ReturnType<typeof mount> | undefined
	let transactionUi: ReturnType<typeof mount> | undefined
	let accountUi: ReturnType<typeof mount> | undefined
	let classificationUis: ReturnType<typeof mount>[] = []
	let sections: HTMLElement[] = []
	return {
		imageReports: () => imageReports,
		processImage(file: File) {
			return new Promise<unknown[]>((resolve, reject) => {
				const worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' })
				const reports: unknown[] = []
				imageReports = reports
				worker.addEventListener('message', (event: MessageEvent<unknown>) => {
					reports.push(event.data)
					if (
						typeof event.data === 'object' &&
						event.data !== null &&
						'type' in event.data &&
						event.data.type === 'DONE'
					) {
						worker.terminate()
						resolve(reports)
					}
				})
				worker.addEventListener('error', (error) => {
					worker.terminate()
					reject(new Error(error.message))
				})
				worker.postMessage(file)
			})
		},
		start(serverUrl: string, legacyScope: string, pathname = '/') {
			if (owner && owner.state() !== 'closed')
				throw new Error('Previous runtime still owns resources')
			history.replaceState(null, '', pathname)
			const connection = new FinanceWindowConnection({
				serverUrl,
				legacyScope,
				route: { pathname: location.pathname, search: location.search, hash: location.hash },
				readHref: () => `${location.pathname}${location.search}${location.hash}`,
				navigate: async (destination, replace) => {
					if (replace) history.replaceState(null, '', destination)
					else history.pushState(null, '', destination)
					connection.send({
						type: 'ROUTE',
						route: { pathname: location.pathname, search: location.search, hash: location.hash }
					})
				},
				reload: () => {}
			})
			transport = connection
			owner = createFinanceWindowRuntime(connection)
			accountUi = mount(WorkerAccounts, {
				target: document.body,
				props: { runtime: owner.context }
			})
			overviewSection = document.createElement('section')
			overviewSection.dataset.testid = 'overview'
			document.body.append(overviewSection)
			overviewUi = mount(WorkerOverview, {
				target: overviewSection,
				props: { runtime: owner.context }
			})
			const transactionTarget = document.createElement('section')
			transactionTarget.dataset.testid = 'transaction-entry'
			document.body.append(transactionTarget)
			sections.push(transactionTarget)
			transactionUi = mount(WorkerTransactionEntry, {
				target: transactionTarget,
				props: {
					runtime: owner.context,
					navigate: (destination: string) => {
						history.pushState(null, '', destination)
						connection.send({
							type: 'ROUTE',
							route: { pathname: location.pathname, search: location.search, hash: location.hash }
						})
					}
				}
			})
			ledgerUi = mount(WorkerLedger, { target: document.body, props: { runtime: owner.context } })
			classificationUis = ['categories', 'tags'].map((kind) => {
				const target = document.createElement('section')
				target.dataset.testid = kind
				document.body.append(target)
				sections.push(target)
				return mount(WorkerClassification, {
					target,
					props: { kind: kind === 'categories' ? 'categories' : 'tags', runtime: owner!.context }
				})
			})
		},
		route(pathname: string) {
			if (!transport) throw new Error('Worker transport unavailable')
			history.replaceState(null, '', pathname)
			transport.send({
				type: 'ROUTE',
				route: { pathname: location.pathname, search: location.search, hash: location.hash }
			})
		},
		transactionEdit(command: TransactionEditIntent, expectedGeneration?: number) {
			const view = owner ? get(owner.context.view)?.workspace : undefined
			if (!view?.generation || !transport) throw new Error('Worker workspace unavailable')
			transport.send({
				type: 'TRANSACTION_EDIT',
				generation: view.generation,
				formGeneration: expectedGeneration ?? view.transaction.generation,
				command
			})
		},

		transaction(command: TransactionRouteIntent, expectedGeneration?: number) {
			const view = owner ? get(owner.context.view)?.workspace : undefined
			if (!view?.generation || !transport) throw new Error('Worker workspace unavailable')
			transport.send({
				type: 'TRANSACTION_FORM',
				generation: view.generation,
				formGeneration: expectedGeneration ?? view.transaction.generation,
				draftRevision: view.transaction.form.draftRevision,
				command
			})
		},
		overview(command: OverviewCommand) {
			const generation = owner ? get(owner.context.view)?.workspace.generation : undefined
			if (!generation || !transport) throw new Error('Worker workspace unavailable')
			transport.send({ type: 'OVERVIEW', generation, command })
		},
		ledger(command: LedgerCommand) {
			const generation = owner ? get(owner.context.view)?.workspace.generation : undefined
			if (!generation || !transport) throw new Error('Worker workspace unavailable')
			transport.send({ type: 'LEDGER', generation, command })
		},
		accountForm(command: AccountFormIntent, expectedGeneration?: number) {
			const generation =
				expectedGeneration ?? (owner ? get(owner.context.view)?.workspace.generation : undefined)
			if (!generation || !transport) throw new Error('Worker workspace unavailable')
			const draftRevision = owner
				? get(owner.context.view)?.workspace.accountForm.draftRevision
				: undefined
			if (draftRevision === undefined) throw new Error('Worker form unavailable')
			transport.send({ type: 'ACCOUNT_FORM', generation, draftRevision, command })
		},
		workspace(command: WorkspaceCommand) {
			const generation = owner ? get(owner.context.view)?.workspace.generation : undefined
			if (!generation || !transport) throw new Error('Worker workspace unavailable')
			transport.send({ type: 'WORKSPACE', generation, command })
		},
		view: () => (owner ? get(owner.context.view) : undefined),
		host: () => owner?.state(),
		async close() {
			if (owner) {
				await owner.close()
				if (accountUi) await unmount(accountUi)
				if (transactionUi) await unmount(transactionUi)
				if (ledgerUi) await unmount(ledgerUi)
				if (overviewUi) await unmount(overviewUi)
				overviewSection?.remove()
				for (const ui of classificationUis) await unmount(ui)
				for (const section of sections) section.remove()
				classificationUis = []
				sections = []
			}
		}
	}
}
declare global {
	interface Window {
		financeWorkerRuntime: ReturnType<typeof harness>
	}
}
window.financeWorkerRuntime = harness()
