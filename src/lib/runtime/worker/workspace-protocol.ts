import { transactionRouteViewSchema } from './transaction-route-protocol.js'
import { emptyTransactionRouteView } from './transaction-route-protocol.js'
import { overviewViewSchema, emptyOverviewView } from './overview-protocol.js'
import { ledgerViewSchema, emptyLedgerView } from './ledger-protocol.js'
import { accountActionsViewSchema, emptyAccountActions } from './account-actions-protocol.js'
import { managementViewSchema, emptyManagementView } from './management-protocol.js'
import { z } from 'zod'
import { accountFormViewSchema, projectAccountForm } from './form-protocol.js'

export const CATALOG_PAGE_SIZE = 500
const id = z.string().uuid()
const name = z.string().max(4096)
export const organizationViewSchema = z
	.object({
		id,
		name,
		kind: z.enum(['personal', 'business']),
		defaultCurrency: z.string().max(64),
		ownerId: id
	})
	.strict()
export const accountViewSchema = z
	.object({
		id,
		organizationId: id,
		name,
		kind: z.enum(['cash', 'bank', 'card']),
		currency: z.string().max(64),
		archivedAt: z.date().nullable(),
		selected: z.boolean(),
		balanceMinor: z.bigint().nullable()
	})
	.strict()
export const workspaceCommandSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('RETRY') }).strict(),
	z.object({ type: z.literal('RETRY_INTEGRITY') }).strict(),
	z.object({ type: z.literal('RETRY_NAVIGATION') }).strict(),
	z.object({ type: z.literal('SELECT_WORKSPACE'), workspaceId: id }).strict(),
	z
		.object({
			type: z.literal('CREATION'),
			event: z.discriminatedUnion('type', [
				z.object({ type: z.literal('SUBMIT'), name: z.string().max(4096) }).strict(),
				z.object({ type: z.literal('RETRY') }).strict(),
				z.object({ type: z.literal('NEW') }).strict()
			])
		})
		.strict()
])
const catalogPage = z
	.object({
		offset: z.number().int().nonnegative(),
		total: z.number().int().nonnegative(),
		hasMore: z.boolean()
	})
	.strict()
export const workspaceViewSchema = z
	.object({
		overview: overviewViewSchema,
		transaction: transactionRouteViewSchema,
		ledger: ledgerViewSchema,
		allAccountsSelected: z.boolean(),
		accountDefaultCurrency: z.enum(['USD', 'TZS']),
		management: managementViewSchema,
		accountActions: accountActionsViewSchema,
		accountForm: accountFormViewSchema,
		generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
		organizationId: id.nullable(),
		ready: z.boolean(),
		failed: z.boolean(),
		canRetry: z.boolean(),
		canSync: z.boolean(),
		navigation: z.enum(['waiting', 'scoped', 'directory', 'global', 'unavailable', 'failed']),
		integrity: z
			.object({
				mode: z.enum(['waiting', 'working', 'complete', 'partial', 'conflict', 'failed']),
				canRetry: z.boolean()
			})
			.strict(),
		creation: z
			.object({
				draftRevision: z.number().int().nonnegative(),
				mode: z.enum([
					'unavailable',
					'working',
					'editing',
					'invalid',
					'recovered',
					'complete',
					'conflict',
					'failed',
					'unresolved'
				]),
				name,
				workspace: organizationViewSchema.nullable(),
				canSubmit: z.boolean(),
				canRetry: z.boolean(),
				canCreateAnother: z.boolean()
			})
			.strict(),
		organizations: z.array(organizationViewSchema).max(CATALOG_PAGE_SIZE),
		accounts: z.array(accountViewSchema).max(CATALOG_PAGE_SIZE),
		organizationPage: catalogPage,
		accountPage: catalogPage,
		queries: z
			.object({
				organizationsLoading: z.boolean(),
				organizationsFailed: z.boolean(),
				accountsLoading: z.boolean(),
				accountsFailed: z.boolean(),
				balancesLoading: z.boolean(),
				balancesFailed: z.boolean()
			})
			.strict()
	})
	.strict()
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>
export type PublicWorkspaceView = z.infer<typeof workspaceViewSchema>
export function emptyWorkspaceView(generation = 0): PublicWorkspaceView {
	return {
		overview: emptyOverviewView(),
		transaction: emptyTransactionRouteView(),
		ledger: emptyLedgerView(),
		allAccountsSelected: true,
		accountDefaultCurrency: 'USD',
		management: emptyManagementView(),
		accountActions: emptyAccountActions(),
		accountForm: projectAccountForm(undefined),
		generation,
		organizationId: null,
		ready: false,
		failed: false,
		canRetry: false,
		canSync: false,
		navigation: 'waiting',
		integrity: { mode: 'waiting', canRetry: false },
		creation: {
			draftRevision: 0,
			mode: 'unavailable',
			name: '',
			workspace: null,
			canSubmit: false,
			canRetry: false,
			canCreateAnother: false
		},
		organizations: [],
		accounts: [],
		organizationPage: { offset: 0, total: 0, hasMore: false },
		accountPage: { offset: 0, total: 0, hasMore: false },
		queries: {
			organizationsLoading: true,
			organizationsFailed: false,
			accountsLoading: true,
			accountsFailed: false,
			balancesLoading: true,
			balancesFailed: false
		}
	}
}
