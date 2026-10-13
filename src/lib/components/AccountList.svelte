<script lang="ts">
	import { getContext } from 'svelte'
	import { useMachine } from '@xstate/svelte'
	import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { app } from '#lib/schema.js'
	import { archiveAccount } from '#lib/data.js'
	import { accountArchiveSchema } from '#lib/validation/accounts.js'
	import { createFormMachine } from '#lib/machines/form.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import QueryContent from './QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const db = getDb()
	const session = getJazzSession()
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
		const userId = $session.account?.id
		return organizationId && userId
			? app.organizationMembers.where({ organizationId, userId })
			: undefined
	})
	const grants = new QuerySubscription(() => {
		const organizationId = filters.activeOrganizationId
		const userId = $session.account?.id
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
	const archiving = $derived($snapshot.hasTag('busy'))

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
</script>

<svelte:head>
	<title>{m['labels.accounts']()} · {m['app.name']()}</title>
</svelte:head>

<h1>{m['labels.accounts']()}</h1>
<p><a href="/accounts/new">{m['actions.add_account']()}</a></p>

{#if $snapshot.matches('success') && $snapshot.context.result}
	<p role="status">{m['accounts.archived']({ name: $snapshot.context.result })}</p>
{:else if $snapshot.matches('error') || $snapshot.matches('invalid')}
	<p role="alert">{m['errors.archive']({ subject: m['labels.account']() })}</p>
{/if}

<QueryContent
	queries={[accounts, membership, grants]}
	loadingMessage={m['status.loading']({ subject: m['labels.accounts']() })}
	errorMessage={m['errors.load']({ subject: m['labels.accounts']() })}
>
	{#if visibleAccounts.length === 0}
		<p>{m['accounts.empty.title']()}</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th scope="col">{m['labels.account_name']()}</th>
					<th scope="col">{m['labels.account_type']()}</th>
					<th scope="col">{m['labels.currency']()}</th>
					<th scope="col">{m['labels.actions']()}</th>
				</tr>
			</thead>
			<tbody>
				{#each visibleAccounts as account (account.id)}
					<tr>
						<td>{account.name}</td>
						<td>
							{account.kind === 'cash'
								? m['accounts.type.cash']()
								: account.kind === 'bank'
									? m['accounts.type.bank']()
									: m['accounts.type.card']()}
						</td>
						<td>{account.currency}</td>
						<td>
							{#if canArchive(account.id)}
								<button
									type="button"
									disabled={archiving}
									aria-label={m['actions.archive_account']({ name: account.name })}
									onclick={() =>
										send({
											type: 'SUBMIT',
											values: { accountId: account.id, organizationId: account.organizationId }
										})}
								>
									{archiving && $snapshot.context.validated?.value.accountId === account.id
										? m['status.archiving']({ subject: m['labels.account']() })
										: m['actions.archive']()}
								</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</QueryContent>
