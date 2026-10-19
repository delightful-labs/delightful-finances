<script lang="ts">
	import {
		Button,
		InputText,
		InputDate,
		Select,
		Textarea,
		InputCurrency,
		FieldFeedback,
		StatusMessage
	} from 'delightful-ui'
	import { AMOUNT_INPUT_PATTERN } from '#lib/domain/money.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import type { Account, Category } from '#lib/schema.js'
	import type { TransactionEntryView } from '#lib/transaction-entry-contract.js'
	import FormFeedback from './FormFeedback.svelte'
	import { formReasonText } from '#lib/form-messages.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'
	import TransactionTagInput from './TransactionTagInput.svelte'

	let {
		kind,
		organizationId,
		accounts,
		defaultAccountId,
		categories,
		defaultCategoryId,
		tagSuggestions,
		view,
		onsubmit,
		onreset
	}: {
		kind: 'expense' | 'income'
		organizationId: string | null
		accounts: readonly Account[]
		defaultAccountId: string | undefined
		categories: readonly Category[]
		defaultCategoryId: string | undefined
		tagSuggestions: readonly string[]
		view: TransactionEntryView
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
	} = $props()
	let showCheckFields = $state(false)
	const resetRevision = $derived(view.draftRevision)
	$effect(() => {
		void resetRevision
		showCheckFields = false
	})
	function syncPaymentMethod(element: HTMLSelectElement) {
		showCheckFields = element.value === 'check'
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
				(path[0] === 'checkDetails' && path[1] === field)
		)
	}
</script>

{#key `${organizationId}:${kind}`}
	<FormContent {view} {onsubmit} {onreset}>
		{#snippet fields(form)}
			{#if form.content.kind !== 'success'}
				<Select
					label={m['labels.account']()}
					id="transaction-account"
					aria-describedby="transaction-account-feedback"
					aria-invalid={fieldInvalid(issues, 'accountId') || undefined}
					name="accountId"
					required
					defaultValue={defaultAccountId ?? ''}
				>
					<option value="" disabled>{m['transactions.select_account']()}</option>
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
					label={m['labels.category']()}
					id="transaction-category"
					aria-describedby="transaction-category-feedback"
					aria-invalid={fieldInvalid(issues, 'categoryId') || undefined}
					name="categoryId"
					required
					defaultValue={defaultCategoryId ?? ''}
				>
					<option value="" disabled>
						{m['transactions.select_category']()}
					</option>
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
					currencyLabel="USD"
					id="transaction-amount"
					aria-describedby="transaction-amount-feedback"
					aria-invalid={fieldInvalid(issues, 'amount') || undefined}
					name="amount"
					inputmode="decimal"
					autocomplete="off"
					pattern={AMOUNT_INPUT_PATTERN}
					required
				/>
				<FieldFeedback
					id="transaction-amount-feedback"
					errorMessage={fieldInvalid(issues, 'amount') ? m['transactions.amount_invalid']() : ''}
				/>

				<InputDate
					label={m['labels.date']()}
					id="transaction-date"
					aria-describedby="transaction-date-feedback"
					aria-invalid={fieldInvalid(issues, 'bookedOn') || undefined}
					name="bookedOn"
					defaultValue={todayDateOnly()}
					required
				/>
				<FieldFeedback
					id="transaction-date-feedback"
					errorMessage={fieldInvalid(issues, 'bookedOn') ? m['transactions.date_invalid']() : ''}
				/>

				{#if kind === 'income'}
					<Select
						label={m['transactions.payment.method']()}
						id="transaction-payment-method"
						aria-describedby="transaction-payment-method-feedback"
						aria-invalid={fieldInvalid(issues, 'paymentMethod') || undefined}
						name="paymentMethod"
						required
						defaultValue="cash"
						{@attach syncPaymentMethod}
						onchange={(event) => syncPaymentMethod(event.currentTarget)}
					>
						<option value="cash">{m['transactions.payment.cash']()}</option>
						<option value="check">{m['transactions.payment.check']()}</option>
						<option value="transfer">{m['transactions.payment.transfer']()}</option>
						<option value="electronic">{m['transactions.payment.electronic']()}</option>
					</Select>
					<FieldFeedback
						id="transaction-payment-method-feedback"
						errorMessage={fieldInvalid(issues, 'paymentMethod')
							? m['transactions.payment_invalid']()
							: ''}
					/>

					{#if showCheckFields}
						<InputText
							label={m['transactions.check.number']()}
							id="check-number"
							aria-describedby="check-number-feedback"
							aria-invalid={fieldInvalid(issues, 'checkNumber') || undefined}
							name="checkNumber"
							required
						/>
						<FieldFeedback
							id="check-number-feedback"
							errorMessage={fieldInvalid(issues, 'checkNumber')
								? m['transactions.check_number_invalid']()
								: ''}
						/>

						<InputDate
							label={m['transactions.check.date']()}
							id="check-date"
							aria-describedby="check-date-feedback"
							aria-invalid={fieldInvalid(issues, 'checkDate') || undefined}
							name="checkDate"
							required
						/>
						<FieldFeedback
							id="check-date-feedback"
							errorMessage={fieldInvalid(issues, 'checkDate')
								? m['transactions.check_date_invalid']()
								: ''}
						/>
					{/if}
				{/if}

				{#if organizationId}
					<TransactionTagInput
						{organizationId}
						suggestions={tagSuggestions}
						disabled={!form.fieldsEditable}
					/>
				{/if}
				<InputText
					label={m['labels.description']()}
					id="transaction-description"
					name="description"
				/>
				<Textarea label={m['labels.memo']()} id="transaction-memo" name="memo"></Textarea>
			{/if}
		{/snippet}
		{#snippet controls(form)}
			{#if form.content.kind === 'success'}
				<Button type="reset">{m['transactions.add_another']()}</Button>
			{:else}
				<Button type="submit" disabled={!form.canSubmit}>
					{m['transactions.save']()}
				</Button>
			{/if}
		{/snippet}
		{#snippet feedback(view)}
			<FormFeedback
				{view}
				subject={m['labels.transaction']()}
				reasonText={(reason) => formReasonText[reason]()}
				invalidMessage={m['transactions.validation_error']()}
				section="result"
			/>
		{/snippet}
	</FormContent>
{/key}
