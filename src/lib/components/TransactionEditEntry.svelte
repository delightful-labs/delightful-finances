<script lang="ts">
	import { EXPENSE, INCOME, transactionPages } from '#lib/domain/transaction-kind.js'
	import { canWriteAccount } from '#lib/domain/organization-permissions.js'
	import { findInternalTransferCounterparts } from '#lib/domain/internal-transfer.js'
	import {
		internalTransferLinkMachine,
		type InternalTransferLinkResult
	} from '#lib/machines/internal-transfer.js'
	import { observeRow, observeRows } from '#lib/observations.js'
	import { createScopedFormController } from '#lib/forms.svelte.js'
	import { app, transactionDetailQuery } from '#lib/schema.js'
	import {
		applicableTransactionCategories,
		applicableTransactionTags,
		createTransactionEditFormOptions,
		writableTransactionAccounts
	} from '#lib/machines/transaction-entry.js'
	import type { TransactionEntryObservation } from '#lib/transaction-entry-contract.js'
	import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import {
		accountOrderKey,
		financeFiltersKey,
		type AccountOrder,
		type FinanceFilters
	} from '#lib/finance-filters.js'
	import { getContext, onDestroy } from 'svelte'
	import { page } from '$app/state'
	import { orderAccounts } from '#lib/machines/account-order.js'
	import { createActor } from 'xstate'
	import { m } from '#lib/paraglide/messages.js'
	import { formReasonText } from '#lib/form-messages.js'
	import FormFeedback from './FormFeedback.svelte'
	import PageHeader from './PageHeader.svelte'
	import QueryContent from './QueryContent.svelte'
	import TransactionDetails from './TransactionDetails.svelte'
	import TransactionForm from './TransactionForm.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const accountOrder = getContext<AccountOrder>(accountOrderKey)
	const db = getDb()
	const session = fromStore(getJazzSession())
	const transactionQuery = new QuerySubscriptionOne(() =>
		filters.activeOrganizationId
			? transactionDetailQuery.where({
					id: page.params.id ?? '',
					organizationId: filters.activeOrganizationId
				})
			: undefined
	)
	const counterpartQuery = new QuerySubscription(() => {
		const current = transaction
		const organizationId = filters.activeOrganizationId
		return current && organizationId
			? app.transactions.where({
					organizationId,
					kind: current.kind === EXPENSE ? INCOME : EXPENSE,
					amountMinor: BigInt(current.amountMinor),
					currency: current.currency
				})
			: undefined
	})
	const transferLinksQuery = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.internalTransfers.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const transferAccountsQuery = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts.where({ organizationId: filters.activeOrganizationId }).orderBy('name')
			: undefined
	)
	const membershipQuery = new QuerySubscriptionOne(() =>
		organizationMembershipQuery(filters.activeOrganizationId, session.current.account?.id)
	)
	const grantsQuery = new QuerySubscription(() =>
		filters.activeOrganizationId && session.current.account?.id
			? app.accountMemberships.where({
					organizationId: filters.activeOrganizationId,
					userId: session.current.account.id
				})
			: undefined
	)
	const accountQuery = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const transaction = $derived(observeRow(transactionQuery.current))
	const categoryQuery = new QuerySubscription(() =>
		filters.activeOrganizationId && transaction?.kind
			? app.categories
					.where({
						organizationId: filters.activeOrganizationId,
						kind: transaction.kind,
						archivedAt: { isNull: true }
					})
					.orderBy('name')
			: undefined
	)
	const tagQuery = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.tags
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const loadingQueries = [
		transactionQuery,
		membershipQuery,
		grantsQuery,
		accountQuery,
		categoryQuery,
		tagQuery
	]
	function observe(): TransactionEntryObservation {
		const transactionId = page.params.id ?? null
		const organizationId = filters.activeOrganizationId
		const current = transaction
		return {
			identityId: session.current.account?.id ?? null,
			organizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready',
			kind: current?.kind ?? EXPENSE,
			transactionId,
			membership: observeRow(membershipQuery.current),
			grants: observeRows(grantsQuery.current),
			accounts: observeRows(accountQuery.current),
			categories: observeRows(categoryQuery.current),
			tags: observeRows(tagQuery.current),
			loading: loadingQueries.some((query) => query.isLoading),
			failed: loadingQueries.some((query) => query.error != null),
			transaction:
				current?.id === transactionId && current.organizationId === organizationId ? current : null
		}
	}
	const availableAccounts = $derived(
		orderAccounts(writableTransactionAccounts(observe()), accountOrder.ids)
	)
	const availableCategories = $derived(applicableTransactionCategories(observe()))
	const tagSuggestions = $derived(applicableTransactionTags(observe()).map((tag) => tag.name))
	const counterpartRows = $derived(observeRows(counterpartQuery.current))
	const transferLinks = $derived(observeRows(transferLinksQuery.current))
	const linkedTransactionIds = $derived(
		new Set(transferLinks.flatMap((link) => [link.expenseTransactionId, link.incomeTransactionId]))
	)
	const transferSuggestions = $derived(
		transaction
			? findInternalTransferCounterparts(transaction, counterpartRows, linkedTransactionIds).map(
					(candidate) => {
						const row = counterpartRows.find(({ id }) => id === candidate.id)
						return {
							...candidate,
							description: row?.description,
							accountName: transferAccountsQuery.current?.find(
								(account) => account.id === candidate.accountId
							)?.name
						}
					}
				)
			: []
	)
	const writableTransferSuggestionIds = $derived(
		new Set(
			transferSuggestions
				.filter(
					(candidate) =>
						transaction &&
						canWriteAccount(
							membershipQuery.current,
							filters.activeOrganizationId,
							transaction.accountId,
							grantsQuery.current ?? []
						) &&
						canWriteAccount(
							membershipQuery.current,
							filters.activeOrganizationId,
							candidate.accountId,
							grantsQuery.current ?? []
						)
				)
				.map(({ id }) => id)
		)
	)
	const transferSuggestionsLoading = $derived(
		counterpartQuery.isLoading || transferLinksQuery.isLoading || transferAccountsQuery.isLoading
	)
	const transferSuggestionsFailed = $derived(
		counterpartQuery.error != null ||
			transferLinksQuery.error != null ||
			transferAccountsQuery.error != null
	)
	let transferLinkPending = $state(false)
	let transferLinkResult = $state<InternalTransferLinkResult | null>(null)
	type LinkScope = {
		identityId: string | null
		organizationId: string | null
		transactionId: string | null
		db: object | null
	}
	function currentLinkScope(): LinkScope {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			transactionId: page.params.id ?? null,
			db: session.current.client?.db ?? null
		}
	}
	function sameLinkScope(first: LinkScope, second: LinkScope) {
		return (
			first.identityId === second.identityId &&
			first.organizationId === second.organizationId &&
			first.transactionId === second.transactionId &&
			first.db === second.db
		)
	}
	let activeLinkScope: LinkScope | null = null
	let shutdownLinkActor: (() => void) | null = null
	$effect(() => {
		const scope = currentLinkScope()
		if (activeLinkScope && !sameLinkScope(activeLinkScope, scope)) shutdownLinkActor?.()
		if (
			!activeLinkScope ||
			activeLinkScope.identityId !== scope.identityId ||
			activeLinkScope.organizationId !== scope.organizationId ||
			activeLinkScope.transactionId !== scope.transactionId
		) {
			transferLinkResult = null
		}
	})
	function linkCounterpart(transactionId: string) {
		const source = transaction
		const candidate = transferSuggestions.find((suggestion) => suggestion.id === transactionId)
		const scope = currentLinkScope()
		if (
			transferLinkPending ||
			!source ||
			!candidate ||
			!writableTransferSuggestionIds.has(transactionId) ||
			!scope.identityId ||
			!scope.organizationId ||
			scope.transactionId !== source.id ||
			!session.current.client?.db
		)
			return
		transferLinkResult = null
		transferLinkPending = true
		const actor = createActor(internalTransferLinkMachine, {
			input: {
				db,
				identityId: scope.identityId,
				organizationId: scope.organizationId,
				expenseTransactionId: source.kind === EXPENSE ? source.id : candidate.id,
				incomeTransactionId: source.kind === INCOME ? source.id : candidate.id
			}
		})
		activeLinkScope = scope
		shutdownLinkActor = () => actor.send({ type: 'SHUTDOWN' })
		const subscription = actor.subscribe((snapshot) => {
			if (snapshot.status !== 'done') return
			if (sameLinkScope(scope, currentLinkScope())) transferLinkResult = snapshot.output
			if (activeLinkScope && sameLinkScope(activeLinkScope, scope)) {
				transferLinkPending = false
				activeLinkScope = null
				shutdownLinkActor = null
			}
			subscription.unsubscribe()
			actor.stop()
		})
		actor.start()
	}
	onDestroy(() => shutdownLinkActor?.())
	const creatorQuery = new QuerySubscriptionOne(() =>
		transaction ? app.profiles.where({ userId: transaction.$createdBy.account }) : undefined
	)
	const editorQuery = new QuerySubscriptionOne(() =>
		transaction ? app.profiles.where({ userId: transaction.$updatedBy.account }) : undefined
	)
	const initialTransaction = $derived.by(() => {
		const row = transaction
		if (!row) return undefined
		return {
			accountId: row.accountId,
			categoryId: row.categoryId,
			amountMinor: row.amountMinor,
			currency: row.currency,
			accountName: row.account?.name,
			categoryName: row.category?.name,
			bookedOn: row.bookedOn,
			...(row.description ? { description: row.description } : {}),
			...(row.memo ? { memo: row.memo } : {}),
			...(row.checkId ? { checkId: row.checkId } : {}),
			...(row.paymentMethod ? { paymentMethod: row.paymentMethod } : {}),
			...(row.check
				? {
						check: {
							checkNumber: row.check.checkNumber,
							checkDate: row.check.checkDate ?? ''
						}
					}
				: {}),
			tags: row.tags?.flatMap((link) => (link.tag?.name ? [link.tag.name] : [])) ?? []
		}
	})
	const entryForm = createTransactionEditFormOptions({
		binding: db,
		observe,
		db
	})
	const entryController = createScopedFormController({ ...entryForm, arrayFields: () => ['tags'] })
</script>

<svelte:head
	><title
		>{m['labels.subject_details']({ subject: m['nouns.transaction']({ count: 1 }) })} · {m[
			'app.name'
		]()}</title
	></svelte:head
>
<PageHeader
	title={m['labels.subject_details']({ subject: m['nouns.transaction']({ count: 1 }) })}
/>
<QueryContent
	queries={[transactionQuery]}
	loadingMessage={m['status.loading_subject']({ subject: m['nouns.transaction']({ count: 1 }) })}
	errorMessage={m['errors.load_subject']({ subject: m['nouns.transaction']({ count: 1 }) })}
>
	{#key `${session.current.account?.id}:${filters.activeOrganizationId}:${page.params.id}`}
		<TransactionDetails
			transaction={observe().transaction}
			creatorProfile={creatorQuery.current}
			editorProfile={editorQuery.current}
		>
			{#snippet form()}
				<FormFeedback
					view={entryController.view}
					subject={m['nouns.transaction']({ count: 1 })}
					reasonText={(reason) => formReasonText[reason]()}
					invalidMessage={m['transactions.validation_error']()}
					section="readiness"
					onRetryReadiness={entryController.retryReadiness}
				/>
				{#if initialTransaction && transaction}
					<TransactionForm
						mode="edit"
						kind={transaction.kind}
						paymentEntry={transactionPages[transaction.kind].paymentEntry}
						{initialTransaction}
						oninput={entryController.input}
						organizationId={filters.activeOrganizationId}
						accounts={availableAccounts}
						defaultAccountId={initialTransaction.accountId}
						categories={availableCategories}
						defaultCategoryId={initialTransaction.categoryId}
						{tagSuggestions}
						{transferSuggestions}
						{writableTransferSuggestionIds}
						{transferSuggestionsLoading}
						{transferSuggestionsFailed}
						{transferLinkPending}
						{transferLinkResult}
						onLinkCounterpart={linkCounterpart}
						view={entryController.view}
						onsubmit={entryController.submit}
						onreset={entryController.reset}
					/>
				{/if}
			{/snippet}
		</TransactionDetails>
	{/key}
</QueryContent>
