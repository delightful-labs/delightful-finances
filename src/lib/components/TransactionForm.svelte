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
	import type { AppTransaction } from '#lib/domain/transaction.js'
	import type { FormController } from '#lib/forms.svelte.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'
	import TransactionTagInput from './TransactionTagInput.svelte'

	let {
		kind,
		organizationId,
		accounts,
		categories,
		defaultCategoryId,
		tagSuggestions,
		form
	}: {
		kind: 'expense' | 'income'
		organizationId: string | null
		accounts: readonly Account[]
		categories: readonly Category[]
		defaultCategoryId: string | undefined
		tagSuggestions: readonly string[]
		form: FormController<
			AppTransaction,
			void,
			{ organizationId: string | null; kind: 'expense' | 'income' }
		>
	} = $props()
	let showCheckFields = $state(false)
	function syncPaymentMethod(element: HTMLSelectElement) {
		showCheckFields = element.value === 'check'
	}
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
	<FormContent view={form.view} onsubmit={form.submit} onreset={form.reset}>
		{#snippet fields(form)}
			{#if !form.state.matches('success')}
				<Select
					label={m['labels.account']()}
					id="transaction-account"
					aria-describedby="transaction-account-feedback"
					aria-invalid={fieldInvalid(form.issues, 'accountId') || undefined}
					name="accountId"
					required
					defaultValue=""
				>
					<option value="" disabled>{m['transactions.select_account']()}</option>
					{#each accounts as account (account.id)}
						<option value={account.id}>{account.name}</option>
					{/each}
				</Select>
				<FieldFeedback
					id="transaction-account-feedback"
					errorMessage={fieldInvalid(form.issues, 'accountId')
						? m['transactions.account_invalid']()
						: ''}
				/>

				{#key defaultCategoryId}
					<Select
						label={m['labels.category']()}
						id="transaction-category"
						aria-describedby="transaction-category-feedback"
						aria-invalid={fieldInvalid(form.issues, 'categoryId') || undefined}
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
						errorMessage={fieldInvalid(form.issues, 'categoryId')
							? m['transactions.category_invalid']()
							: ''}
					/>
				{/key}

				<InputCurrency
					label={m['labels.amount']()}
					currencyLabel="USD"
					id="transaction-amount"
					aria-describedby="transaction-amount-feedback"
					aria-invalid={fieldInvalid(form.issues, 'amount') || undefined}
					name="amount"
					inputmode="decimal"
					autocomplete="off"
					pattern={AMOUNT_INPUT_PATTERN}
					required
				/>
				<FieldFeedback
					id="transaction-amount-feedback"
					errorMessage={fieldInvalid(form.issues, 'amount')
						? m['transactions.amount_invalid']()
						: ''}
				/>

				<InputDate
					label={m['labels.date']()}
					id="transaction-date"
					aria-describedby="transaction-date-feedback"
					aria-invalid={fieldInvalid(form.issues, 'bookedOn') || undefined}
					name="bookedOn"
					defaultValue={todayDateOnly()}
					required
				/>
				<FieldFeedback
					id="transaction-date-feedback"
					errorMessage={fieldInvalid(form.issues, 'bookedOn')
						? m['transactions.date_invalid']()
						: ''}
				/>

				{#if kind === 'income'}
					<Select
						label={m['transactions.payment.method']()}
						id="transaction-payment-method"
						aria-describedby="transaction-payment-method-feedback"
						aria-invalid={fieldInvalid(form.issues, 'paymentMethod') || undefined}
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
						errorMessage={fieldInvalid(form.issues, 'paymentMethod')
							? m['transactions.payment_invalid']()
							: ''}
					/>

					{#if showCheckFields}
						<InputText
							label={m['transactions.check.number']()}
							id="check-number"
							aria-describedby="check-number-feedback"
							aria-invalid={fieldInvalid(form.issues, 'checkNumber') || undefined}
							name="checkNumber"
							required
						/>
						<FieldFeedback
							id="check-number-feedback"
							errorMessage={fieldInvalid(form.issues, 'checkNumber')
								? m['transactions.check_number_invalid']()
								: ''}
						/>

						<InputDate
							label={m['transactions.check.date']()}
							id="check-date"
							aria-describedby="check-date-feedback"
							aria-invalid={fieldInvalid(form.issues, 'checkDate') || undefined}
							name="checkDate"
							required
						/>
						<FieldFeedback
							id="check-date-feedback"
							errorMessage={fieldInvalid(form.issues, 'checkDate')
								? m['transactions.check_date_invalid']()
								: ''}
						/>
					{/if}
				{/if}

				{#if organizationId}
					<TransactionTagInput {organizationId} suggestions={tagSuggestions} disabled={form.busy} />
				{/if}
				<Textarea label={m['labels.memo']()} id="transaction-memo" name="memo"></Textarea>
			{/if}
		{/snippet}
		{#snippet controls(form)}
			{#if form.state.matches('success')}
				<Button type="reset">{m['transactions.add_another']()}</Button>
			{:else}
				<Button type="submit" disabled={form.disabled}>
					{form.busy
						? m['status.saving']({ subject: m['labels.transaction']() })
						: m['transactions.save']()}
				</Button>
			{/if}
		{/snippet}
		{#snippet feedback(form)}
			{#if form.state.matches('success')}
				<StatusMessage variant="success" text={m['transactions.saved']()} />
			{:else if form.state.matches('invalid')}
				<StatusMessage variant="error" text={m['transactions.validation_error']()} />
			{:else if form.state.matches('error')}
				<StatusMessage
					variant="error"
					text={m['errors.save']({ subject: m['labels.transaction']() })}
				/>
			{/if}
		{/snippet}
	</FormContent>
{/key}
