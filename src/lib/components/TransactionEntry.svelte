<script lang="ts">
	import { observeRow, observeRows } from '#lib/observations.js'
	import { orderAccounts } from '#lib/machines/account-order.js'
	import { createScopedFormController } from '#lib/forms.svelte.js'
	import { app } from '#lib/schema.js'
	import { defaultTransactionCategory } from '#lib/validation/transactions.js'
	import {
		createTransactionEntryFormOptions,
		writableTransactionAccounts,
		applicableTransactionCategories
	} from '#lib/machines/transaction-entry.js'
	import type {
		TransactionEntryObservation,
		TransactionEntryReason,
		TransactionEntryScope
	} from '#lib/transaction-entry-contract.js'
	import type { SnapshotFrom } from 'xstate'
	import FormFeedback from './FormFeedback.svelte'
	import { formReasonText } from '#lib/form-messages.js'
	import { fromStore } from 'svelte/store'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import type { AppTransaction } from '#lib/domain/transaction.js'
	import { createTransaction } from '#lib/data.js'
	import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { getContext } from 'svelte'
	import {
		financeFiltersKey,
		accountOrderKey,
		type FinanceFilters,
		type AccountOrder
	} from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import AccountCreation from '#lib/components/AccountCreation.svelte'
	import TransactionForm from '#lib/components/TransactionForm.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'
	let { kind }: { kind: 'income' | 'expense' } = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const accountOrder = getContext<AccountOrder>(accountOrderKey)

	const db = getDb()
	const tagQuery = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.tags
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const tagSuggestions = $derived((tagQuery.current ?? []).map((tag) => tag.name))
	const accountQuery = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const categoryQuery = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories
					.where({
						organizationId: filters.activeOrganizationId,
						kind,
						archivedAt: { isNull: true }
					})
					.orderBy('name')
			: undefined
	)

	const session = fromStore(getJazzSession())
	const membership = new QuerySubscriptionOne(() =>
		organizationMembershipQuery(filters.activeOrganizationId, session.current.account?.id)
	)
	const grantQuery = new QuerySubscription(() =>
		filters.activeOrganizationId && session.current.account?.id
			? app.accountMemberships.where({
					organizationId: filters.activeOrganizationId,
					userId: session.current.account.id
				})
			: undefined
	)
	function observe(): TransactionEntryObservation {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready',
			kind,
			membership: observeRow(membership.current),
			grants: observeRows(grantQuery.current),
			accounts: observeRows(accountQuery.current),
			categories: observeRows(categoryQuery.current),
			loading: [membership, grantQuery, accountQuery, categoryQuery, tagQuery].some(
				(q) => q.isLoading
			),
			failed: [membership, grantQuery, accountQuery, categoryQuery, tagQuery].some(
				(q) => q.error != null
			)
		}
	}
	const accounts = $derived(orderAccounts(writableTransactionAccounts(observe()), accountOrder.ids))
	const defaultAccountId = $derived(
		accounts.find(
			(account) =>
				filters.selectedAccountIds === null || filters.selectedAccountIds.includes(account.id)
		)?.id
	)
	const availableCategories = $derived(applicableTransactionCategories(observe()))
	const defaultCategory = $derived(
		defaultTransactionCategory({
			organizationId: filters.activeOrganizationId,
			kind,
			categories: availableCategories
		})
	)
	const options = createTransactionEntryFormOptions({
		binding: db,
		observe,
		create: async (transaction) => {
			const result = await createTransaction(db, transaction)
			if ('error' in result) throw new Error(result.error)
		}
	})
	const form = createScopedFormController<
		AppTransaction,
		void,
		TransactionEntryReason,
		TransactionEntryScope,
		TransactionEntryObservation,
		SnapshotFrom<typeof options.availability>,
		SnapshotFrom<typeof options.operation>
	>({ ...options, arrayFields: () => ['tags'] })
</script>

<svelte:head
	><title
		>{m['actions.add']({
			name: kind === 'income' ? m['labels.income']() : m['labels.expenses']()
		})} · {m['app.name']()}</title
	></svelte:head
>
<PageHeader
	title={m['actions.add']({
		name: kind === 'income' ? m['labels.income']() : m['labels.expenses']()
	})}
/>

<FormFeedback
	view={form.view}
	subject={m['labels.transaction']()}
	reasonText={(reason) => formReasonText[reason]()}
	invalidMessage={m['transactions.validation_error']()}
	section={form.view.readiness.kind === 'ready' ? 'readiness' : 'all'}
	onRetryReadiness={form.retryReadiness}
/>
{#if form.view.readiness.kind === 'blocked' && form.view.readiness.reason === 'noAccounts'}
	<AccountCreation />
{:else if form.view.readiness.kind === 'ready'}
	<TransactionForm
		{kind}
		organizationId={filters.activeOrganizationId}
		{accounts}
		{defaultAccountId}
		categories={availableCategories}
		defaultCategoryId={defaultCategory?.id}
		{tagSuggestions}
		view={form.view}
		onsubmit={form.submit}
		onreset={form.reset}
	/>
{/if}
