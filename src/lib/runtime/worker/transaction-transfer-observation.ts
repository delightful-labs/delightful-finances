import type { Db } from 'jazz-tools'
import { app, type InternalTransfer, type TransactionRow, type Account } from '../../schema.js'
import {
	resolveInternalTransferLinks,
	type InternalTransferCandidate
} from '../../domain/internal-transfer.js'
import { transactionEntryScope } from '../../machines/transactions/transaction-entry.js'
import type {
	TransactionEntryObservation,
	TransactionEntryScope
} from '../../contracts/transaction-entry-contract.js'
import type { TransactionTransferObservation } from '../../machines/transactions/transaction-edit.js'
import { WorkerQuery } from './query-observation.js'

export function transactionTransferFacts(input: {
	observation: TransactionEntryScope & {
		transaction?: Pick<TransactionRow, 'id' | 'internalTransferId'> | null
	}
	links: readonly InternalTransfer[]
	transactions: readonly InternalTransferCandidate[]
	scopeGeneration: number
	searchEnabled: boolean
	loading: boolean
	failed: boolean
}): TransactionTransferObservation {
	const { observation, scopeGeneration, searchEnabled, loading, failed } = input
	const transaction = observation.transaction
	const links = input.links.filter((row) => row.organizationId === observation.organizationId)
	const rows = input.transactions.filter((row) => row.organizationId === observation.organizationId)
	const resolution = resolveInternalTransferLinks(
		links,
		transaction ? [transaction, ...rows.filter((row) => row.id !== transaction.id)] : rows
	)
	const related = (link: Pick<InternalTransfer, 'expenseTransactionId' | 'incomeTransactionId'>) =>
		!!transaction &&
		(link.expenseTransactionId === transaction.id || link.incomeTransactionId === transaction.id)
	const effective = resolution.effectiveLinks.find(related)
	const pending = resolution.pendingLinks.find(related)
	const selected = effective ?? pending
	const relatedIds = new Set(transaction ? [transaction.id] : [])
	if (transaction && selected)
		relatedIds.add(
			selected.expenseTransactionId === transaction.id
				? selected.incomeTransactionId
				: selected.expenseTransactionId
		)
	const conflicted =
		!!transaction &&
		!loading &&
		(resolution.conflictedLinks.some(
			(link) =>
				relatedIds.has(link.expenseTransactionId) || relatedIds.has(link.incomeTransactionId)
		) ||
			(transaction.internalTransferId != null &&
				!links.some((link) => link.id === transaction.internalTransferId && related(link))))
	const linkedTransfer = conflicted
		? null
		: (links.find((link) => link.id === selected?.id) ?? null)
	return {
		scope: transactionEntryScope(observation),
		scopeGeneration,
		searchEnabled,
		rows: rows.filter((row) => row.kind !== observation.kind),
		linkedTransactionIds: [
			...new Set(links.flatMap((link) => [link.expenseTransactionId, link.incomeTransactionId]))
		],
		linkedTransfer,
		linked: linkedTransfer !== null,
		conflicted,
		pendingUnlink: linkedTransfer !== null && linkedTransfer.id === pending?.id,
		loading,
		failed
	}
}

/** Private worker query leases. Domain matching and authorization stay in the
 * invoked edit chart; no complete history is sent to Window. */
export class WorkerTransactionTransferObservation {
	private readonly links: WorkerQuery<InternalTransfer>
	private labelScope: string | null | undefined
	private labelTransactions: readonly TransactionRow[] | undefined
	private labelAccounts: readonly Account[] | undefined
	private rowsById: ReadonlyMap<string, TransactionRow> = new Map()
	private accountNames: ReadonlyMap<string, string> = new Map()
	private readonly accounts: WorkerQuery<Account>
	private readonly transactions: WorkerQuery<TransactionRow>
	constructor(db: Db, changed: () => void) {
		this.accounts = new WorkerQuery<Account>(db, changed)
		this.links = new WorkerQuery<InternalTransfer>(db, changed)
		this.transactions = new WorkerQuery<TransactionRow>(db, changed)
	}
	bind(organizationId: string | null) {
		if (this.labelScope !== organizationId) {
			this.labelScope = organizationId
			this.labelTransactions = undefined
			this.labelAccounts = undefined
			this.rowsById = new Map()
			this.accountNames = new Map()
		}
		const key = JSON.stringify(organizationId)
		this.accounts.set(key, organizationId ? app.accounts.where({ organizationId }) : undefined)
		this.links.set(
			key,
			organizationId ? app.internalTransfers.where({ organizationId }) : undefined
		)
		this.transactions.set(
			key,
			organizationId ? app.transactions.where({ organizationId }) : undefined
		)
	}
	facts() {
		return [
			this.accounts.current,
			this.accounts.isLoading,
			this.accounts.error,
			this.links.current,
			this.links.isLoading,
			this.links.error,
			this.transactions.current,
			this.transactions.isLoading,
			this.transactions.error
		]
	}
	observe(
		observation: TransactionEntryObservation,
		scopeGeneration: number,
		searchEnabled: boolean
	) {
		return transactionTransferFacts({
			observation,
			scopeGeneration,
			searchEnabled,
			links: this.links.current ?? [],
			transactions: this.transactions.current ?? [],
			loading: this.links.isLoading || this.transactions.isLoading || this.accounts.isLoading,
			failed: !!this.links.error || !!this.transactions.error || !!this.accounts.error
		})
	}
	labels(id: string) {
		if (this.labelTransactions !== this.transactions.current) {
			this.labelTransactions = this.transactions.current
			this.rowsById = new Map(this.transactions.current?.map((row) => [row.id, row]))
		}
		if (this.labelAccounts !== this.accounts.current) {
			this.labelAccounts = this.accounts.current
			this.accountNames = new Map(this.accounts.current?.map((row) => [row.id, row.name]))
		}
		const row = this.rowsById.get(id)
		return {
			description: row?.description ?? null,
			accountName: row ? (this.accountNames.get(row.accountId) ?? null) : null
		}
	}
	close() {
		this.labelScope = undefined
		this.rowsById = new Map()
		this.accountNames = new Map()
		this.labelTransactions = undefined
		this.labelAccounts = undefined
		this.accounts.clear()
		this.links.clear()
		this.transactions.clear()
	}
}
