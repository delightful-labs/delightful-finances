import { z } from 'zod'
import { accountRowSchema } from './form-protocol.js'
import type {
	AccountArchivePresentation,
	AccountDeletePresentation,
	AccountPermissionSource
} from '../../contracts/account-presentation-contract.js'

const id = z.string().uuid()
const archiveNotice = z
	.object({
		key: z.enum([
			'status.archived_subject_name',
			'accounts.archive_interrupted_saved',
			'accounts.archive_scope_changed',
			'accounts.archive_restricted',
			'errors.archive_subject'
		]),
		variant: z.enum(['success', 'error']),
		name: z.string().max(4096)
	})
	.strict()
const grantNotice = z
	.object({
		key: z.enum([
			'permissions.updated',
			'permissions.update_failed',
			'permissions.manage_restricted'
		]),
		variant: z.enum(['success', 'error']),
		accountId: id.nullable()
	})
	.strict()
export const accountActionsCommandSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('ARCHIVE_ACCOUNT'), accountId: id }).strict(),
	z
		.object({ type: z.literal('SET_DELETE'), accountId: id, userId: id, canDelete: z.boolean() })
		.strict(),
	z
		.object({ type: z.literal('ACCOUNT_ACTIONS'), open: z.boolean(), accountId: id.nullable() })
		.strict(),
	z
		.object({
			type: z.literal('ACCOUNT_PERMISSIONS_PAGE'),
			offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
		})
		.strict()
])
export const ACCOUNT_ACTIONS_PAGE_SIZE = 500
const receiptRequest = z.object({ accountId: id, name: z.string().max(4096) }).strict()
const archiveReceipt = z.discriminatedUnion('outcome', [
	z
		.object({
			outcome: z.literal('succeeded'),
			settlement: z.literal('locallyPersisted'),
			request: receiptRequest
		})
		.strict(),
	z
		.object({
			outcome: z.enum(['invalid', 'denied', 'unavailable']),
			settlement: z.literal('notStarted'),
			request: receiptRequest
		})
		.strict(),
	z
		.object({
			outcome: z.literal('failed'),
			settlement: z.enum(['rejected', 'unknown']),
			request: receiptRequest
		})
		.strict(),
	z
		.object({
			outcome: z.enum(['scopeChanged', 'cancelled', 'closed']),
			settlement: z.enum(['notStarted', 'locallyPersisted', 'rejected']),
			request: receiptRequest
		})
		.strict()
])
export const accountActionsViewSchema = z
	.object({
		archive: z
			.object({
				kind: z.enum([
					'sessionUnavailable',
					'selectWorkspace',
					'loading',
					'loadFailed',
					'ready',
					'closed'
				]),
				rows: z
					.array(
						z
							.object({
								account: accountRowSchema,
								action: z.enum(['available', 'unavailable', 'archiving', 'disabled'])
							})
							.strict()
					)
					.max(ACCOUNT_ACTIONS_PAGE_SIZE),
				feedback: archiveReceipt.nullable(),
				notice: archiveNotice.nullable()
			})
			.strict(),
		deleteGrants: z
			.object({
				permissionAccountId: id.nullable(),
				busy: z.boolean(),
				canManage: z.boolean(),
				notice: grantNotice.nullable(),
				result: z
					.object({
						outcome: z.enum(['succeeded', 'denied', 'failed']),
						request: z.object({ accountId: id }).strict().nullable()
					})
					.strict()
					.nullable(),
				permissions: z
					.array(z.object({ id, userId: id, canDelete: z.boolean() }).strict())
					.max(ACCOUNT_ACTIONS_PAGE_SIZE)
			})
			.strict(),
		permissionPage: z
			.object({
				offset: z.number().int().nonnegative(),
				total: z.number().int().nonnegative(),
				hasMore: z.boolean()
			})
			.strict(),
		permissionsLoading: z.boolean(),
		permissionsFailed: z.boolean(),
		balancesReady: z.boolean()
	})
	.strict()
export type AccountActionsIntent = z.infer<typeof accountActionsCommandSchema>
export type PublicAccountActions = z.infer<typeof accountActionsViewSchema>
export function projectAccountActions(input: {
	archive: AccountArchivePresentation | undefined
	grants: (AccountDeletePresentation & { canManage: boolean }) | undefined
	observation: AccountPermissionSource | undefined
	selectedAccountId: string | null
	accountOffset: number
	permissionOffset: number
	balancesReady: boolean
}): PublicAccountActions {
	const { archive, grants, observation } = input
	const selected = observation?.accounts.some(
		(row) => row.id === input.selectedAccountId && row.organizationId === observation.organizationId
	)
	const granted = new Set(
		observation?.grants
			.filter(
				(row) =>
					row.accountId === input.selectedAccountId &&
					row.organizationId === observation.organizationId &&
					row.canDelete
			)
			.map((row) => row.userId)
	)
	const members =
		grants?.canManage && selected
			? (observation?.members.filter(
					(row) => row.organizationId === observation.organizationId && row.role === 'member'
				) ?? [])
			: []
	const offset = Math.min(
		Math.floor(input.permissionOffset / ACCOUNT_ACTIONS_PAGE_SIZE) * ACCOUNT_ACTIONS_PAGE_SIZE,
		Math.max(
			0,
			Math.floor((members.length - 1) / ACCOUNT_ACTIONS_PAGE_SIZE) * ACCOUNT_ACTIONS_PAGE_SIZE
		)
	)
	const feedback = archive?.feedback
	const result = grants?.result
	return accountActionsViewSchema.parse({
		archive: {
			kind: archive?.kind ?? 'closed',
			rows:
				archive?.rows
					.slice(input.accountOffset, input.accountOffset + ACCOUNT_ACTIONS_PAGE_SIZE)
					.map(({ account, action }) => {
						const { id, organizationId, name, kind, currency, archivedAt } = account
						return {
							account: {
								id,
								organizationId,
								name: name.slice(0, 4096),
								kind,
								currency,
								archivedAt
							},
							action
						}
					}) ?? [],
			feedback: feedback
				? {
						outcome: feedback.outcome,
						settlement: feedback.settlement,
						request: {
							accountId: feedback.request.accountId,
							name: feedback.request.name.slice(0, 4096)
						}
					}
				: null,
			notice: archive?.notice
				? { ...archive.notice, name: archive.notice.name.slice(0, 4096) }
				: null
		},
		deleteGrants: {
			permissionAccountId: input.selectedAccountId,
			busy: grants?.busy ?? false,
			canManage: grants?.canManage ?? false,
			notice: grants?.notice ?? null,
			result: result
				? {
						outcome: result.outcome,
						request: result.request ? { accountId: result.request.accountId } : null
					}
				: null,
			permissions: members
				.slice(offset, offset + ACCOUNT_ACTIONS_PAGE_SIZE)
				.map(({ id, userId }) => ({ id, userId, canDelete: granted.has(userId) }))
		},
		permissionPage: {
			offset,
			total: members.length,
			hasMore: offset + ACCOUNT_ACTIONS_PAGE_SIZE < members.length
		},
		permissionsLoading: observation?.loading ?? false,
		permissionsFailed: observation?.failed ?? false,
		balancesReady: input.balancesReady
	})
}
export function emptyAccountActions() {
	return projectAccountActions({
		archive: undefined,
		grants: undefined,
		observation: undefined,
		selectedAccountId: null,
		accountOffset: 0,
		permissionOffset: 0,
		balancesReady: false
	})
}
