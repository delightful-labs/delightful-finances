<script lang="ts">
	import { EXPENSE, transactionPages } from '#lib/domain/transaction-kind.js'
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
	import { getContext } from 'svelte'
	import { page } from '$app/state'
	import { orderAccounts } from '#lib/machines/account-order.js'
	import { m } from '#lib/paraglide/messages.js'
	import { formReasonText } from '#lib/form-messages.js'
	import FormFeedback from './FormFeedback.svelte'
	import CategoryForm from './CategoryForm.svelte'
	import { createManagementFormOptions } from '#lib/machines/management.js'
	import { categoryFormSchema } from '#lib/validation/categories.js'
	import { createCategory } from '#lib/data.js'
	import type { ManagementObservation } from '#lib/management-contract.js'
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
	let categoryModal: CategoryForm | undefined = $state()
	const categoryScope = $derived({
		identityId: session.current.account?.id ?? null,
		organizationId: filters.activeOrganizationId,
		binding: session.current.client?.db ?? null
	})
	function observeCategory(): ManagementObservation {
		return {
			...categoryScope,
			sessionReady: session.current.status === 'ready',
			membership: observeRow(membershipQuery.current),
			categories: observeRows(categoryQuery.current),
			tags: [],
			loading: [membershipQuery, categoryQuery, transactionQuery].some((q) => q.isLoading),
			failed: [membershipQuery, categoryQuery, transactionQuery].some((q) => q.error != null)
		}
	}
	const categoryOptions = createManagementFormOptions({ binding: db, observe: observeCategory })({
		schema: categoryFormSchema,
		successContent: 'replace',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			intent: {
				kind: 'createCategory',
				name: request.values.name,
				categoryKind: request.values.kind
			}
		}),
		write: ({ request }) => {
			const organizationId = request.scope.organizationId
			if (!organizationId) throw new Error('Missing authorized workspace')
			return createCategory(db, organizationId, request.values.name, request.values.kind)
		}
	})
	const categoryController = createScopedFormController(categoryOptions)
	const createdCategory = $derived(
		categoryController.view.content.kind === 'success'
			? categoryController.view.content.value
			: undefined
	)
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
						onaddcategory={() => categoryModal?.open()}
						canAddCategory={categoryController.view.canOpen}
						{createdCategory}
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
						view={entryController.view}
						onsubmit={entryController.submit}
						onreset={entryController.reset}
					/>
				{/if}
			{/snippet}
		</TransactionDetails>
	{/key}
</QueryContent>

{#if transaction}
	<CategoryForm
		bind:this={categoryModal}
		scope={categoryScope}
		fixedKind={transaction.kind}
		view={categoryController.view}
		onopen={categoryController.open}
		onsubmit={(event) => {
			event.preventDefault()
			if (!(event.currentTarget instanceof HTMLFormElement) || !transaction) return
			categoryController.submitValues({
				name: new FormData(event.currentTarget).get('name'),
				kind: transaction.kind
			})
		}}
		onreset={categoryController.reset}
		onRetryReadiness={categoryController.retryReadiness}
	>
		{#snippet trigger()}{/snippet}
	</CategoryForm>
{/if}
