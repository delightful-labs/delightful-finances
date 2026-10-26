<script lang="ts">
	import { EXPENSE, INCOME, transactionPages } from '#lib/domain/transaction-kind.js'
	import { inspectInternalTransferCounterparts } from '#lib/domain/internal-transfer.js'
	import { observeRow, observeRows } from '#lib/observations.js'
	import { app, transactionDetailQuery } from '#lib/schema.js'
	import {
		applicableTransactionCategories,
		applicableTransactionTags,
		createTransactionEditFormOptions,
		transactionEntryScope,
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
	import { getContext, onDestroy, onMount, untrack } from 'svelte'
	import { page } from '$app/state'
	import { orderAccounts } from '#lib/machines/account-order.js'
	import { createActor } from 'xstate'
	import { createTransactionEditMachine } from '#lib/machines/transaction-edit.js'
	import { getReadiness } from '#lib/bank-sync.js'
	import type { TransferWriteTracking } from '#lib/machines/internal-transfer.js'
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
	const readiness = getReadiness()
	const trackTransferWrite = (write: TransferWriteTracking) =>
		readiness.actor.send({ type: 'TRANSFER_WRITE_TRACKED', write })
	const session = fromStore(getJazzSession())
	const entryForm = createTransactionEditFormOptions({ binding: db, observe, db })
	const editWorkflow = createTransactionEditMachine(entryForm, db, trackTransferWrite)
	const editActor = createActor(editWorkflow.logic, {
		input: {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: db,
			kind: EXPENSE,
			transactionId: page.params.id ?? null,
			sessionReady: session.current.status === 'ready',
			loading: true,
			failed: false,
			membership: undefined,
			grants: [],
			accounts: [],
			categories: [],
			tags: [],
			transaction: null
		}
	})
	let editSnapshot = $state.raw(editActor.getSnapshot())
	const formView = $derived(editWorkflow.selectFormView(editSnapshot))
	const transferEditorState = $derived(editWorkflow.selectTransferState(editSnapshot))
	const transferSearchEnabled = $derived(
		transferEditorState === 'searching' ||
			transferEditorState === 'matches' ||
			transferEditorState === 'empty' ||
			transferEditorState === 'failed'
	)
	const transferLinkPending = $derived(editWorkflow.isLinkPending(editSnapshot))
	const transferUnlinkPending = $derived(editWorkflow.isUnlinkPending(editSnapshot))
	const transferLinkResult = $derived(editSnapshot.context.linkResult)
	const transferUnlinkResult = $derived(editSnapshot.context.unlinkResult)
	const selectedTransferCandidateId = $derived(editSnapshot.context.selectedCandidateId)
	$effect(() => {
		const result = transferLinkResult
		if (!import.meta.env.DEV || result?.outcome !== 'unavailable') return
		const error = result.error
		console.error('[transfer-link] operation unavailable', {
			phase: result.phase ?? 'before commit',
			settlement: result.settlement,
			error:
				error instanceof Error
					? { name: error.name, message: error.message, stack: error.stack, cause: error.cause }
					: error === undefined
						? 'No error detail was returned'
						: error
		})
	})
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
		return transferSearchEnabled && current && organizationId
			? app.transactions.where({
					organizationId,
					kind: current.kind === EXPENSE ? INCOME : EXPENSE
				})
			: undefined
	})
	const transferLinksQuery = new QuerySubscription(() =>
		filters.activeOrganizationId && transactionQuery.current
			? app.internalTransfers.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const transferAccountsQuery = new QuerySubscription(() =>
		filters.activeOrganizationId &&
		(transferSearchEnabled ||
			Boolean(transactionQuery.current?.internalTransferId) ||
			linkedTransfer)
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
	onMount(() => {
		const subscription = editActor.subscribe({ next: (snapshot) => (editSnapshot = snapshot) })
		editActor.start()
		return () => subscription.unsubscribe()
	})
	$effect(() => {
		const observation = observe()
		untrack(() => editActor.send({ type: 'OBSERVE', observation }))
	})
	onDestroy(() => {
		if (editActor.getSnapshot().status !== 'active') {
			editActor.stop()
			return
		}
		const completion = editActor.subscribe({
			complete: () => editActor.stop(),
			error: () => editActor.stop()
		})
		editActor.send({ type: 'SHUTDOWN' })
		if (editActor.getSnapshot().status === 'done') {
			completion.unsubscribe()
			editActor.stop()
		}
	})
	function valuesFromForm(form: HTMLFormElement) {
		const data = new FormData(form)
		return {
			...Object.fromEntries(data),
			tags: data.getAll('tags')
		}
	}
	function submitForm(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		editActor.send({ type: 'OBSERVE', observation: observe() })
		editActor.send({
			type: 'FORM',
			event: { type: 'SUBMIT', values: valuesFromForm(event.currentTarget) }
		})
	}
	function inputForm(event: Event) {
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		editActor.send({ type: 'OBSERVE', observation: observe() })
		editActor.send({
			type: 'FORM',
			event: { type: 'CHANGE', values: valuesFromForm(event.currentTarget) }
		})
	}
	function resetForm(event: Event) {
		event.preventDefault()
		editActor.send({ type: 'FORM', event: { type: 'RESET' } })
	}
	function retryReadiness() {
		editActor.send({ type: 'FORM', event: { type: 'RETRY_READINESS' } })
	}
	const availableAccounts = $derived(
		orderAccounts(writableTransactionAccounts(observe()), accountOrder.ids)
	)
	const availableCategories = $derived(applicableTransactionCategories(observe()))
	const tagSuggestions = $derived(applicableTransactionTags(observe()).map((tag) => tag.name))
	const counterpartRows = $derived(observeRows(counterpartQuery.current))
	const transferLinks = $derived(observeRows(transferLinksQuery.current))
	const linkedTransfer = $derived(
		transferLinks.find(
			({ id, expenseTransactionId, incomeTransactionId }) =>
				id === transaction?.internalTransferId ||
				expenseTransactionId === transaction?.id ||
				incomeTransactionId === transaction?.id
		) ?? null
	)
	const linkedCounterpartHref = $derived.by(() => {
		if (!linkedTransfer || !transaction) return null
		const counterpartId =
			linkedTransfer.expenseTransactionId === transaction.id
				? linkedTransfer.incomeTransactionId
				: linkedTransfer.incomeTransactionId === transaction.id
					? linkedTransfer.expenseTransactionId
					: null
		if (!counterpartId) return null
		const counterpartKind = transaction.kind === EXPENSE ? INCOME : EXPENSE
		return `${transactionPages[counterpartKind].path}/${encodeURIComponent(counterpartId)}`
	})
	const linkedTransactionIds = $derived(
		new Set(transferLinks.flatMap((link) => [link.expenseTransactionId, link.incomeTransactionId]))
	)
	const transferSuggestions = $derived(
		editSnapshot.context.candidates.map((candidate) => ({
			...candidate,
			description: counterpartRows.find(({ id }) => id === candidate.id)?.description,
			accountName: transferAccountsQuery.current?.find(
				(account) => account.id === candidate.accountId
			)?.name
		}))
	)
	const writableTransferSuggestionIds = $derived(editWorkflow.writableCandidateIds(editSnapshot))
	const transferUnlinkWritable = $derived(editWorkflow.unlinkWritable(editSnapshot))
	const transferMatchDiagnostics = $derived(
		transaction && transferSearchEnabled
			? inspectInternalTransferCounterparts(transaction, counterpartRows, linkedTransactionIds).map(
					({ candidate, checks, eligible }) => ({
						candidate: {
							...candidate,
							description: counterpartRows.find(({ id }) => id === candidate.id)?.description,
							accountName: transferAccountsQuery.current?.find(
								(account) => account.id === candidate.accountId
							)?.name
						},
						checks,
						eligible
					})
				)
			: []
	)
	$effect(() => {
		const searchEnabled = transferSearchEnabled
		const linked = linkedTransfer !== null
		if (!searchEnabled && !linked) return
		const observation = {
			rows: counterpartRows,
			scope: transactionEntryScope(observe()),
			scopeGeneration: untrack(() => editActor.getSnapshot().context.scopeGeneration),
			linkedTransactionIds: [...linkedTransactionIds],
			linkedTransfer,
			linked,
			pendingUnlink: Boolean(
				linkedTransfer && transaction?.internalTransferId !== linkedTransfer.id
			),
			loading:
				counterpartQuery.isLoading ||
				transferLinksQuery.isLoading ||
				transferAccountsQuery.isLoading,
			failed:
				counterpartQuery.error != null ||
				transferLinksQuery.error != null ||
				transferAccountsQuery.error != null
		}
		untrack(() => editActor.send({ type: 'TRANSFER_OBSERVATION', observation }))
	})
	$effect(() => {
		if (!import.meta.env.DEV || !transaction || !transferSearchEnabled) return
		const diagnostics = inspectInternalTransferCounterparts(
			transaction,
			counterpartRows,
			linkedTransactionIds
		)
		console.groupCollapsed('[transfer-match] eligibility checks')
		console.info('Search status', {
			activeWorkspaceAvailable: Boolean(filters.activeOrganizationId),
			oppositeKindQuery: true,
			counterpartsLoading: counterpartQuery.isLoading,
			counterpartsFailed: counterpartQuery.error != null,
			candidateCount: counterpartQuery.isLoading ? 'pending' : diagnostics.length,
			transferLinksLoading: transferLinksQuery.isLoading,
			transferLinksFailed: transferLinksQuery.error != null,
			accountsLoading: transferAccountsQuery.isLoading,
			accountsFailed: transferAccountsQuery.error != null
		})
		if (counterpartQuery.isLoading) {
			console.info('Waiting for the workspace counterpart query to finish.')
		} else if (diagnostics.length > 0) {
			console.table(
				diagnostics.map(({ checks, eligible }, index) => ({
					candidate: index + 1,
					...checks,
					eligible
				}))
			)
		} else {
			console.info('No opposite-kind candidate rows were returned by the workspace query.')
		}
		console.groupEnd()
	})
	function linkCounterpart(transactionId: string) {
		editActor.send({ type: 'LINK_COUNTERPART', candidateId: transactionId })
	}
	function selectTransferCandidate(transactionId: string) {
		editActor.send({ type: 'SELECT_COUNTERPART', candidateId: transactionId })
	}
	function unlinkTransfer() {
		editActor.send({ type: 'UNLINK_TRANSFER' })
	}
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
					view={formView}
					subject={m['nouns.transaction']({ count: 1 })}
					reasonText={(reason) => formReasonText[reason]()}
					invalidMessage={m['transactions.validation_error']()}
					section="readiness"
					onRetryReadiness={retryReadiness}
				/>
				{#if initialTransaction && transaction}
					<TransactionForm
						mode="edit"
						kind={transaction.kind}
						paymentEntry={transactionPages[transaction.kind].paymentEntry}
						{initialTransaction}
						oninput={inputForm}
						organizationId={filters.activeOrganizationId}
						accounts={availableAccounts}
						defaultAccountId={initialTransaction.accountId}
						categories={availableCategories}
						defaultCategoryId={initialTransaction.categoryId}
						{tagSuggestions}
						{transferSuggestions}
						{transferMatchDiagnostics}
						{transferEditorState}
						{selectedTransferCandidateId}
						onSelectTransferCandidate={selectTransferCandidate}
						{transferSearchEnabled}
						{writableTransferSuggestionIds}
						onTransferSearchEnabledChange={(enabled) =>
							editActor.send({ type: enabled ? 'ENABLE_SEARCH' : 'DISABLE_SEARCH' })}
						{transferLinkPending}
						{transferLinkResult}
						transferUnlinkAvailable={linkedTransfer !== null}
						{transferUnlinkWritable}
						{transferUnlinkPending}
						{transferUnlinkResult}
						{linkedCounterpartHref}
						onLinkCounterpart={linkCounterpart}
						onUnlinkTransfer={unlinkTransfer}
						view={formView}
						onsubmit={submitForm}
						onreset={resetForm}
					/>
				{/if}
			{/snippet}
		</TransactionDetails>
	{/key}
</QueryContent>
