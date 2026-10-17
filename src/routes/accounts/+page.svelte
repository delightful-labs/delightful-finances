<script lang="ts">
	import { createFormMachine } from '#lib/machines/form.js'
	import { accountArchiveSchema } from '#lib/validation/accounts.js'
	import { archiveAccount } from '#lib/data.js'
	import { app } from '#lib/schema.js'
	import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { useMachine } from '@xstate/svelte'
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import { canWriteAccount } from '#lib/domain/organization-permissions.js'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import AccountCreation from '#lib/components/AccountCreation.svelte'
	import AccountList from '#lib/components/AccountList.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)

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
		return organizationMembershipQuery(organizationId, userId)
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
		return canWriteAccount(
			membership.current,
			filters.activeOrganizationId,
			accountId,
			grants.current ?? []
		)
	}
	const archivableAccountIds = $derived(
		visibleAccounts.filter((account) => canArchive(account.id)).map((account) => account.id)
	)
	function onArchive(accountId: string) {
		send({ type: 'SUBMIT', values: { accountId, organizationId: filters.activeOrganizationId } })
	}
</script>

<svelte:head><title>{m['labels.accounts']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['labels.accounts']()} />
<AccountCreation />
<QueryContent
	queries={[accounts, membership, grants]}
	loadingMessage={m['status.loading']({ subject: m['labels.accounts']() })}
	errorMessage={m['errors.load']({ subject: m['labels.accounts']() })}
>
	<AccountList
		accounts={visibleAccounts}
		{archivableAccountIds}
		{archiving}
		archivingAccountId={archiveState.current.context.validated?.value.accountId}
		archivedName={archiveState.current.matches('success')
			? archiveState.current.context.result
			: undefined}
		archiveFailed={archiveState.current.matches('error') || archiveState.current.matches('invalid')}
		{onArchive}
	/>
</QueryContent>
