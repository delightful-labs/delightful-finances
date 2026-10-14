<script lang="ts">
	import { Button, InputText, InputDate, Select, Textarea } from 'delightful-ui'
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
</script>

{#key `${organizationId}:${kind}`}
	<FormContent view={form.view} onsubmit={form.submit} onreset={form.reset}>
		{#snippet fields(form)}
			{#if !form.state.matches('success')}
				<Select
					label={m['labels.account']()}
					id="transaction-account"
					name="accountId"
					required
					defaultValue=""
				>
					<option value="" disabled>{m['transactions.select_account']()}</option>
					{#each accounts as account (account.id)}
						<option value={account.id}>{account.name}</option>
					{/each}
				</Select>

				{#key defaultCategoryId}
					<Select
						label={m['labels.category']()}
						id="transaction-category"
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
				{/key}

				<!-- Future currency entry: docs/delightful-ui-integration.md#currency-entry -->
				<InputText
					label={`${m['labels.amount']()} (USD)`}
					id="transaction-amount"
					name="amount"
					inputmode="decimal"
					autocomplete="off"
					pattern={AMOUNT_INPUT_PATTERN}
					required
				/>

				<InputDate
					label={m['labels.date']()}
					id="transaction-date"
					name="bookedOn"
					defaultValue={todayDateOnly()}
					required
				/>

				{#if kind === 'income'}
					<Select
						label={m['transactions.payment.method']()}
						id="transaction-payment-method"
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

					{#if showCheckFields}
						<InputText
							label={m['transactions.check.number']()}
							id="check-number"
							name="checkNumber"
							required
						/>

						<InputDate
							label={m['transactions.check.date']()}
							id="check-date"
							name="checkDate"
							required
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
				<p role="status">{m['transactions.saved']()}</p>
			{:else if form.state.matches('invalid')}
				<p role="alert">{m['transactions.validation_error']()}</p>
			{:else if form.state.matches('error')}
				<p role="alert">{m['errors.save']({ subject: m['labels.transaction']() })}</p>
			{/if}
		{/snippet}
	</FormContent>
{/key}
