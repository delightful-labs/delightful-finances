export { bankObservation } from './availability.js'
import type { schema } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import type { Account, OrganizationMember, app } from '#lib/schema.js'
import type { BankTrace } from '#lib/integrations/diagnostics.js'
import type { CredentialScope } from '#lib/validation/integrations.js'
import type { fetchAccounts } from '#lib/integrations/simplefin.js'

export type Connection = schema.RowOf<typeof app.simplefinConnections>
export type ProviderSummary = { id: string; name: string; currency: string }
export type ImportCounts = { imported: number; existing: number; omitted: number }
export type ImportSettlement = 'settled' | 'unresolved'
export type ImportResult =
	| { kind: 'complete'; counts: ImportCounts; error: undefined; settlement: 'settled' }
	| {
			kind: 'cancelled' | 'failed'
			counts: ImportCounts
			error: unknown
			settlement: ImportSettlement
	  }
export type ProviderResponse = Awaited<ReturnType<typeof fetchAccounts>>
export type BankCommand =
	| { type: 'DISCOVER' }
	| { type: 'SYNC' }
	| { type: 'MAP'; providerId: string; accountId: string }
	| { type: 'CREATE_ACCOUNT'; providerId: string }
	| { type: 'DISCONNECT' }
export type BankEvent =
	| BankCommand
	| { type: 'CONNECT'; token: string }
	| { type: 'TEST_ENCRYPTION' }
	| { type: 'VERIFY_DECRYPTION' }
	| { type: 'SAVE_CONNECTION' }
	| { type: 'CANCEL' }
	| { type: 'RESET' }
export type ProgressEvent = { type: 'IMPORT_PROGRESS'; counts: ImportCounts }
export { bankSetupSteps } from '#lib/bank-presentation-contract.js'
export type {
	BankSetupView,
	BankStatus,
	BankStatusKey,
	BankStepLabelKey,
	LastSync
} from '#lib/bank-presentation-contract.js'
import type { BankSetupView, BankStatus } from '#lib/bank-presentation-contract.js'
export type BankViewMeta = {
	status?: BankStatus
	setupStep?: number
	setupView?: BankSetupView
	loadingProvider?: boolean
}
// Metadata is a presentation projection of active states, never stored workflow state.
export function bankViewMetadata(
	...snapshots: ({ getMeta: () => Record<string, BankViewMeta | undefined> } | undefined)[]
): BankViewMeta {
	return snapshots.reduce<BankViewMeta>(
		(view, snapshot) =>
			Object.values(snapshot?.getMeta() ?? {}).reduce<BankViewMeta>(
				(combined, metadata) => ({ ...combined, ...metadata }),
				view
			),
		{}
	)
}
export type LockEvent = { type: 'LOCK_ACQUIRED' } | { type: 'LOCK_FAILED'; error: unknown }
export type Result<Value> = { ok: true; value: Value } | { ok: false; error: unknown }
export type Observation = {
	organizationId: string | null
	userId: string | undefined
	allowed: boolean
	connected: boolean
	sessionReady: boolean
	connection: Connection | undefined
}
export type RequestIdentity = Pick<Observation, 'userId' | 'organizationId'>
export type Dependencies = {
	db: ReturnType<typeof getDb>
	observe: () => Observation
	passkeyName: () => string
}
export type OperationWork = {
	command: BankCommand
	current: Connection
	scope: CredentialScope
	trace: BankTrace
	attemptAt: Date
}
export type AuthorizationRequest = {
	scope: CredentialScope
	requireConnection: boolean
	expectedCiphertext: string | undefined
}
export function credentialAuthorization(work: OperationWork): AuthorizationRequest {
	return {
		scope: work.scope,
		requireConnection: true,
		expectedCiphertext: work.current.ciphertext ?? undefined
	}
}
export function emptyCounts(): ImportCounts {
	return { imported: 0, existing: 0, omitted: 0 }
}
export function bankErrorCode(error: unknown) {
	return error instanceof Error &&
		[
			'mode_mismatch',
			'passkey_failure',
			'claim_failure',
			'invalid_setup_token',
			'account_already_linked',
			'save_failure',
			'other_tab',
			'locking_unavailable',
			'unlock_failure',
			'provider_failure',
			'mapping'
		].includes(error.message)
		? error.message
		: 'failure'
}

export type BankEnvironment = {
	scopeKey: string
	credentialFingerprint: string
	allowed: boolean
	connected: boolean
	connectionActive: boolean
}
export function bankEnvironment(current: Observation): BankEnvironment {
	const connection = current.connection
	return {
		scopeKey: JSON.stringify([
			current.userId,
			current.organizationId,
			current.allowed,
			current.sessionReady
		]),
		credentialFingerprint: JSON.stringify([
			connection?.id,
			connection?.status,
			connection?.ciphertext,
			connection?.credentialId,
			connection?.prfSalt,
			connection?.iv,
			connection?.credentialVersion
		]),
		allowed: current.allowed,
		connected: current.connected,
		connectionActive: current.connection?.status === 'active'
	}
}

export type BankSource = {
	organizationId: string | null
	userId: string | undefined
	sessionReady: boolean
	membership: OrganizationMember | null | undefined
	connections: readonly Connection[]
	accounts: readonly Account[]
	links: readonly schema.RowOf<typeof app.simplefinAccountLinks>[]
}
export type BankSyncDependencies = Omit<Dependencies, 'observe'> & { read: () => BankSource }
export type BankData = {
	accounts: readonly Account[]
	mappings: ReadonlyMap<string, string>
}
export function bankData(source: BankSource): BankData {
	return {
		accounts: source.accounts.filter(
			(account) => account.organizationId === source.organizationId && !account.archivedAt
		),
		mappings: new Map(
			source.links
				.filter((link) => link.organizationId === source.organizationId)
				.map((link) => [link.simplefinAccountId, link.accountId])
		)
	}
}
