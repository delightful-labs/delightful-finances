import { useMachine } from '@xstate/svelte'
import { fromStore } from 'svelte/store'
import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
import { app } from '#lib/schema.js'
import { archiveAccount } from '#lib/data.js'
import { accountArchiveSchema } from '#lib/validation/accounts.js'
import { createFormMachine } from '#lib/machines/form.js'
import type { FinanceFilters } from '#lib/finance-filters.js'

export function createAccountListState(filters: FinanceFilters) {
	const db = getDb()
	const session = fromStore(getJazzSession())
	const accounts = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const visibleAccounts = $derived(accounts.current ?? [])
	const membership = new QuerySubscriptionOne(() => {
		const organizationId = filters.activeOrganizationId
		const userId = session.current.account?.id
		return organizationId && userId
			? app.organizationMembers.where({ organizationId, userId })
			: undefined
	})
	const grants = new QuerySubscription(() => {
		const organizationId = filters.activeOrganizationId
		const userId = session.current.account?.id
		return organizationId && userId
			? app.accountMemberships.where({ organizationId, userId })
			: undefined
	})
	const { snapshot, send } = useMachine(
		createFormMachine(
			accountArchiveSchema,
			async (values, { signal }) => {
				signal.throwIfAborted()
				const account = visibleAccounts.find((account) => account.id === values.accountId)
				if (
					values.organizationId !== filters.activeOrganizationId ||
					!account ||
					!canArchive(account.id)
				)
					throw new Error('The account is not editable in the active workspace.')
				await archiveAccount(db, account.id)
				return account.name
			},
			undefined
		)
	)
	const archiveState = fromStore(snapshot)
	const archiving = $derived(archiveState.current.hasTag('busy'))

	function canArchive(accountId: string) {
		const member = membership.current
		if (!member || member.organizationId !== filters.activeOrganizationId) return false
		if (member.role === 'owner' || member.role === 'admin') return true
		return (
			member.role === 'member' &&
			(member.accountAccessMode === 'all' ||
				grants.current?.some(
					(grant) => grant.accountId === accountId && grant.access === 'write'
				) === true)
		)
	}
	const archivableAccountIds = $derived(
		visibleAccounts.filter((account) => canArchive(account.id)).map((account) => account.id)
	)
	return {
		queries: [accounts, membership, grants],
		archive(accountId: string) {
			send({ type: 'SUBMIT', values: { accountId, organizationId: filters.activeOrganizationId } })
		},
		get accounts() {
			return visibleAccounts
		},
		get archivableAccountIds() {
			return archivableAccountIds
		},
		get archiving() {
			return archiving
		},
		get archivingAccountId() {
			return archiveState.current.context.validated?.value.accountId
		},
		get archivedName() {
			return archiveState.current.matches('success')
				? archiveState.current.context.result
				: undefined
		},
		get archiveFailed() {
			return archiveState.current.matches('error') || archiveState.current.matches('invalid')
		}
	}
}
