import type { NewTagDraft } from './transaction-new-tag-draft.js'
import type {
	InternalTransferLinkResult,
	InternalTransferUnlinkResult,
	InternalTransferDeleteResult
} from '../machines/transfers/internal-transfer.js'
import type { InternalTransferCandidate } from '../domain/internal-transfer.js'
import type {
	TransactionEditTransferState,
	TransferStatusLabel,
	TransferDeleteFeedback
} from '../machines/transactions/transaction-edit.js'
import type { InternalTransfer } from '../schema.js'
import { z } from 'zod'
import type { TransactionEntryView } from './transaction-entry-contract.js'
export type TransactionCreateRoute =
	{ kind: 'expense'; pathname: '/expenses/new' } | { kind: 'income'; pathname: '/income/new' }
export type TransactionRouteFormCommand =
	| { type: 'TAG_PAGE'; offset: number }
	| { type: 'OPEN' | 'RESET' | 'CANCEL' | 'RETRY_READINESS' }
	| { type: 'SUBMIT' | 'CHANGE'; values: unknown }
export type TransactionRouteView = {
	generation: number
	route: TransactionRoute | null
	mode: 'idle' | 'active' | 'draining' | 'failed' | 'closed'
	form: TransactionEntryView | undefined
	transfer?: TransactionRouteTransferView | undefined
	removedTagIds?: ReadonlySet<string> | undefined
	newTags?: NewTagDraft | undefined
}
export function transactionCreateRoute(pathname: string): TransactionCreateRoute | null {
	if (pathname === '/expenses/new') return { kind: 'expense', pathname }
	if (pathname === '/income/new') return { kind: 'income', pathname }
	return null
}

export type TransactionEditRoute = {
	kind: 'expense' | 'income'
	pathname: string
	transactionId: string
}
/** Only canonical entity paths can acquire a selected transaction lease. */
export function transactionEditRoute(pathname: string): TransactionEditRoute | null {
	const match = /^\/(expenses|income)\/([^/]+)$/.exec(pathname)
	if (!match) return null
	const id = z.uuid().safeParse(match[2])
	if (!id.success) return null
	return { kind: match[1] === 'income' ? 'income' : 'expense', pathname, transactionId: id.data }
}

export type TransactionRoute = TransactionCreateRoute | TransactionEditRoute
export function transactionRoute(pathname: string): TransactionRoute | null {
	return transactionCreateRoute(pathname) ?? transactionEditRoute(pathname)
}

export type TransactionRouteEditCommand =
	| { type: 'ENABLE_SEARCH' | 'DISABLE_SEARCH' | 'UNLINK_TRANSFER' }
	| { type: 'SELECT_COUNTERPART' | 'LINK_COUNTERPART'; candidateId: string }
	| {
			type: 'DELETE_LINKED_TRANSFER'
			choice: { kind: 'both' } | { kind: 'selected'; transactionId: string }
	  }

export type TransactionRouteTransferView = {
	state: TransactionEditTransferState
	statusLabel?: TransferStatusLabel | null
	deleteFeedback?: TransferDeleteFeedback | null
	canDelete?: boolean
	candidates: readonly InternalTransferCandidate[]
	selectedCandidateId: string | null
	writableCandidateIds: ReadonlySet<string>
	linkedTransfer: InternalTransfer | null
	unlinkWritable: boolean
	linkPending: boolean
	unlinkPending: boolean
	deletePending: boolean
	linkOutcome: InternalTransferLinkResult['outcome'] | null
	unlinkOutcome: InternalTransferUnlinkResult['outcome'] | null
	deleteOutcome: InternalTransferDeleteResult['outcome'] | null
}
