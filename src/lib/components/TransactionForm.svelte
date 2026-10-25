<script lang="ts">
	import { PAYMENT_METHOD } from '#lib/domain/payment-method.js'
	import type { TransactionKind, TransactionPaymentEntry } from '#lib/domain/transaction-kind.js'
	import {
		Button,
		InputText,
		InputDate,
		Select,
		Textarea,
		InputCurrency,
		FieldFeedback
	} from 'delightful-ui'
	import { untrack, tick } from 'svelte'
	import { AMOUNT_INPUT_PATTERN } from '#lib/domain/money.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import type { Account, Category, Tag, TransactionDetail } from '#lib/schema.js'
	import type { InternalTransferCandidate } from '#lib/domain/internal-transfer.js'
	import type { InternalTransferLinkResult } from '#lib/machines/internal-transfer.js'
	import type { TransactionEntryView } from '#lib/transaction-entry-contract.js'
	import FormFeedback from './FormFeedback.svelte'
	import { formReasonText } from '#lib/form-messages.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'
	import TransactionCheckFields from './TransactionCheckFields.svelte'
	import TransactionTagInput from './TransactionTagInput.svelte'
	import InternalTransferSuggestions from './InternalTransferSuggestions.svelte'

	let {
		kind,
		paymentEntry,
		mode = 'create',
		initialTransaction,
		organizationId,
		accounts,
		defaultAccountId,
		categories,
		defaultCategoryId,
		tagSuggestions,
		view,
		onsubmit,
		onreset,
		oncancel,
		oninput,
		transferSuggestions = [],
		writableTransferSuggestionIds = new Set<string>(),
		transferSuggestionsLoading = false,
		transferSuggestionsFailed = false,
		transferLinkPending = false,
		transferLinkResult = null,
		onLinkCounterpart
	}: {
		kind: TransactionKind
		paymentEntry: TransactionPaymentEntry
		mode?: 'create' | 'edit'
		initialTransaction?: Pick<
			TransactionDetail,
			'accountId' | 'categoryId' | 'amountMinor' | 'currency' | 'bookedOn'
		> &
			Partial<Pick<TransactionDetail, 'description' | 'memo' | 'paymentMethod' | 'checkId'>> & {
				accountName?: Account['name'] | undefined
				categoryName?: Category['name'] | undefined
				check?: Pick<NonNullable<TransactionDetail['check']>, 'checkNumber' | 'checkDate'>
				tags: readonly Tag['name'][]
			}
		organizationId: TransactionDetail['organizationId'] | null
		accounts: readonly Account[]
		defaultAccountId: Account['id'] | undefined
		categories: readonly Category[]
		defaultCategoryId: Category['id'] | undefined
		tagSuggestions: readonly Tag['name'][]
		view: TransactionEntryView
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		oncancel?: () => void
		oninput?: (event: Event) => void
		transferSuggestions?: readonly (InternalTransferCandidate & {
			accountName: Account['name'] | undefined
			description: TransactionDetail['description'] | undefined
		})[]
		writableTransferSuggestionIds?: ReadonlySet<string>
		transferSuggestionsLoading?: boolean
		transferSuggestionsFailed?: boolean
		transferLinkPending?: boolean
		transferLinkResult?: InternalTransferLinkResult | null
		onLinkCounterpart?: (transactionId: string) => void
	} = $props()

	const resetRevision = $derived(view.draftRevision)
	let activeCheckFieldsKey = $state('')
	let selectedAccountId = $state('')
	$effect(() => {
		void resetRevision
		untrack(() => {
			activeCheckFieldsKey =
				initialTransaction?.paymentMethod === PAYMENT_METHOD.CHECK ? PAYMENT_METHOD.CHECK : ''
			selectedAccountId = initialTransaction?.accountId ?? defaultAccountId ?? ''
		})
	})
	function syncPaymentMethod(element: HTMLSelectElement) {
		activeCheckFieldsKey = element.value === PAYMENT_METHOD.CHECK ? PAYMENT_METHOD.CHECK : ''
		void tick().then(() => element.dispatchEvent(new Event('input', { bubbles: true })))
	}
	const issues = $derived(
		view.feedback.kind === 'result' && view.feedback.result.outcome === 'invalid'
			? view.feedback.result.issues
			: []
	)
	// Finance maps validation paths to translated messages; the UI stays independent of Zod.
	function fieldInvalid(issues: readonly { path: readonly PropertyKey[] }[], field: string) {
		return issues.some(
			({ path }) =>
				path[0] === field ||
				(field === 'amount' && path[0] === 'money') ||
				(path[0] === 'check' && path[path.length - 1] === field)
		)
	}
</script>

{#key `${organizationId}:${kind}`}
	<FormContent {view} {onsubmit} {onreset} {oninput}>
		{#snippet fields(form)}
			{#if form.content.kind !== 'success'}
				<Select
					label={m['nouns.account']({ count: 1 })}
					id="transaction-account"
					aria-describedby="transaction-account-feedback"
					aria-invalid={fieldInvalid(issues, 'accountId') || undefined}
					name="accountId"
					required
					defaultValue={initialTransaction?.accountId ?? defaultAccountId ?? ''}
					bind:value={selectedAccountId}
				>
					<option value="" disabled
						>{m['actions.select_subject']({ subject: m['nouns.account']({ count: 1 }) })}</option
					>
					{#if initialTransaction && !accounts.some((account) => account.id === initialTransaction?.accountId)}
						<option value={initialTransaction.accountId} disabled
							>{initialTransaction.accountName ??
								m['status.unavailable_subject']({
									subject: m['nouns.account']({ count: 1 })
								})}</option
						>
					{/if}
					{#each accounts as account (account.id)}
						<option value={account.id}>{account.name}</option>
					{/each}
				</Select>
				<FieldFeedback
					id="transaction-account-feedback"
					errorMessage={fieldInvalid(issues, 'accountId')
						? m['transactions.account_invalid']()
						: ''}
				/>

				<Select
					label={m['nouns.category']({ count: 1 })}
					id="transaction-category"
					aria-describedby="transaction-category-feedback"
					aria-invalid={fieldInvalid(issues, 'categoryId') || undefined}
					name="categoryId"
					required
					defaultValue={initialTransaction?.categoryId ?? defaultCategoryId ?? ''}
				>
					<option value="" disabled>
						{m['actions.select_subject']({ subject: m['nouns.category']({ count: 1 }) })}
					</option>
					{#if initialTransaction && !categories.some((category) => category.id === initialTransaction?.categoryId)}
						<option value={initialTransaction.categoryId} disabled
							>{initialTransaction.categoryName ??
								m['status.unavailable_subject']({
									subject: m['nouns.category']({ count: 1 })
								})}</option
						>
					{/if}
					{#each categories as category (category.id)}
						<option value={category.id}>
							{category.name}
						</option>
					{/each}
				</Select>
				<FieldFeedback
					id="transaction-category-feedback"
					errorMessage={fieldInvalid(issues, 'categoryId')
						? m['transactions.category_invalid']()
						: ''}
				/>

				<InputCurrency
					label={m['labels.amount']()}
					currencyLabel={initialTransaction?.currency ?? 'USD'}
					id="transaction-amount"
					aria-describedby="transaction-amount-feedback"
					aria-invalid={fieldInvalid(issues, 'amount') || undefined}
					name="amount"
					inputmode="decimal"
					autocomplete="off"
					pattern={AMOUNT_INPUT_PATTERN}
					defaultValue={initialTransaction ? (initialTransaction.amountMinor / 100).toFixed(2) : ''}
					required
				/>
				<FieldFeedback
					id="transaction-amount-feedback"
					errorMessage={fieldInvalid(issues, 'amount') ? m['transactions.amount_invalid']() : ''}
				/>

				<InputDate
					label={m['nouns.date']({ count: 1 })}
					id="transaction-date"
					aria-describedby="transaction-date-feedback"
					aria-invalid={fieldInvalid(issues, 'bookedOn') || undefined}
					name="bookedOn"
					defaultValue={initialTransaction?.bookedOn ?? todayDateOnly()}
					required
				/>
				<FieldFeedback
					id="transaction-date-feedback"
					errorMessage={fieldInvalid(issues, 'bookedOn') ? m['transactions.date_invalid']() : ''}
				/>

				{#if paymentEntry === 'inline'}
					<Select
						label={m['labels.subject_method']({ subject: m['nouns.payment']({ count: 1 }) })}
						id="transaction-payment-method"
						aria-describedby="transaction-payment-method-feedback"
						aria-invalid={fieldInvalid(issues, 'paymentMethod') || undefined}
						name="paymentMethod"
						defaultValue={initialTransaction?.paymentMethod ?? ''}
						{@attach syncPaymentMethod}
						onchange={(event) => syncPaymentMethod(event.currentTarget)}
					>
						<option value="">{m['labels.unspecified']()}</option>
						<option value={PAYMENT_METHOD.CASH}>{m['labels.cash']()}</option>
						<option value={PAYMENT_METHOD.CHECK}>{m['transactions.payment.check']()}</option>
						<option value={PAYMENT_METHOD.TRANSFER}>{m['transactions.payment.transfer']()}</option>
						<option value={PAYMENT_METHOD.ELECTRONIC}
							>{m['transactions.payment.electronic']()}</option
						>
					</Select>
					<FieldFeedback
						id="transaction-payment-method-feedback"
						errorMessage={fieldInvalid(issues, 'paymentMethod')
							? m['transactions.payment_invalid']()
							: ''}
					/>

					{#key resetRevision}
						<TransactionCheckFields
							active={activeCheckFieldsKey === PAYMENT_METHOD.CHECK}
							{issues}
							initialCheck={initialTransaction?.checkId && initialTransaction.check
								? { id: initialTransaction.checkId, ...initialTransaction.check }
								: undefined}
						/>
					{/key}
				{/if}

				{#if paymentEntry === 'preserve' && initialTransaction?.paymentMethod}
					<input type="hidden" name="paymentMethod" value={initialTransaction.paymentMethod} />
					{#if initialTransaction.checkId}<input
							type="hidden"
							name="checkId"
							value={initialTransaction.checkId}
						/>{/if}
				{/if}
				{#if organizationId}
					<TransactionTagInput
						{organizationId}
						suggestions={tagSuggestions}
						initialTags={initialTransaction?.tags ?? []}
						disabled={!form.fieldsEditable}
					/>
				{/if}
				{#if mode === 'edit' && onLinkCounterpart}
					<InternalTransferSuggestions
						suggestions={transferSuggestions}
						writableSuggestionIds={writableTransferSuggestionIds}
						loading={transferSuggestionsLoading}
						failed={transferSuggestionsFailed}
						pending={transferLinkPending}
						result={transferLinkResult}
						onLink={onLinkCounterpart}
					/>
				{/if}
				<InputText
					label={m['labels.description']()}
					id="transaction-description"
					name="description"
					defaultValue={initialTransaction?.description ?? ''}
				/>
				<Textarea
					label={m['labels.memo']()}
					id="transaction-memo"
					name="memo"
					defaultValue={initialTransaction?.memo ?? ''}
				></Textarea>
			{/if}
		{/snippet}
		{#snippet controls(form)}
			{#if mode === 'create' && oncancel}
				<Button type="button" onclick={oncancel}>{m['actions.cancel']()}</Button>
			{/if}
			{#if form.content.kind === 'success' && mode === 'create'}
				<Button type="reset"
					>{m['actions.add_another_subject']({
						subject: m['nouns.transaction']({ count: 1 })
					})}</Button
				>
			{:else if mode === 'create' || view.readiness.kind === 'ready'}
				<Button type="submit" variant="primary" disabled={!form.canSubmit}>
					{view.feedback.kind === 'result' &&
					view.feedback.result.outcome === 'failed' &&
					view.feedback.result.code === 'completionFailed'
						? m['actions.retry']()
						: m['actions.save_subject']({ subject: m['nouns.transaction']({ count: 1 }) })}
				</Button>
			{/if}
		{/snippet}
		{#snippet feedback(view)}
			<FormFeedback
				{view}
				subject={m['nouns.transaction']({ count: 1 })}
				reasonText={(reason) => formReasonText[reason]()}
				invalidMessage={m['transactions.validation_error']()}
				section="result"
			/>
		{/snippet}
	</FormContent>
{/key}
