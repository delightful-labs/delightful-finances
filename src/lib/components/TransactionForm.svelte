<script lang="ts">
	import { getContext } from 'svelte'
	import { getDb, QuerySubscription } from 'jazz-tools/svelte'
	import { createTransaction } from '#lib/data.js'
	import { AMOUNT_INPUT_PATTERN } from '#lib/domain/money.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import type { AppTransaction } from '#lib/domain/transaction.js'
	import type { FormSave } from '#lib/machines/form.js'
	import {
		defaultTransactionCategory,
		transactionFormSchema
	} from '#lib/validation/transactions.js'
	import { app } from '#lib/schema.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import Form from './Form.svelte'
	import QueryContent from './QueryContent.svelte'

	const db = getDb()
	let { kind }: { kind: 'expense' | 'income' } = $props()
	let showCheckFields = $state(false)

	function syncPaymentMethod(element: HTMLSelectElement) {
		showCheckFields = element.value === 'check'
	}
	const filters = getContext<FinanceFilters>(financeFiltersKey)
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
	const accounts = $derived(accountQuery.current ?? [])
	const availableCategories = $derived(categoryQuery.current ?? [])
	const defaultCategory = $derived(
		defaultTransactionCategory({
			organizationId: filters.activeOrganizationId,
			kind,
			categories: availableCategories
		})
	)

	const schema = transactionFormSchema(() => ({
		organizationId: filters.activeOrganizationId,
		kind,
		accounts,
		categories: availableCategories
	}))
	const save: FormSave<
		AppTransaction,
		void,
		{ organizationId: string | null; kind: typeof kind }
	> = async (transaction, { context, signal }) => {
		signal.throwIfAborted()
		if (
			transaction.organizationId !== context.organizationId ||
			transaction.kind !== context.kind ||
			context.organizationId !== filters.activeOrganizationId
		)
			throw new Error('The transaction workspace changed before saving.')
		const result = await createTransaction(db, transaction)
		if ('error' in result) throw new Error(result.error)
	}
</script>

<svelte:head>
	<title
		>{kind === 'expense' ? m['actions.add_expense']() : m['actions.add_income']()} · {m[
			'app.name'
		]()}</title
	>
</svelte:head>

<h1>{kind === 'expense' ? m['actions.add_expense']() : m['actions.add_income']()}</h1>

<QueryContent
	queries={[accountQuery, categoryQuery]}
	loadingMessage={m['transactions.loading_form_data']()}
	errorMessage={m['transactions.data_load_error']()}
>
	{#if accounts.length === 0}
		<p>{m['transactions.no_accounts']()}</p>
	{:else}
		{#key `${filters.activeOrganizationId}:${kind}`}
			<Form
				{schema}
				{save}
				context={{ organizationId: filters.activeOrganizationId, kind }}
				disabled={availableCategories.length === 0}
			>
				{#snippet fields(form)}
					{#if !form.state.matches('success')}
						<label for="transaction-account">{m['labels.account']()}</label>
						<select id="transaction-account" name="accountId" required>
							<option value="" selected disabled>{m['transactions.select_account']()}</option>
							{#each accounts as account (account.id)}
								<option value={account.id}>{account.name}</option>
							{/each}
						</select>

						<label for="transaction-category">{m['labels.category']()}</label>
						<select id="transaction-category" name="categoryId" required>
							<option value="" selected={!defaultCategory} disabled>
								{m['transactions.select_category']()}
							</option>
							{#each availableCategories as category (category.id)}
								<option value={category.id} selected={category.id === defaultCategory?.id}>
									{category.name}
								</option>
							{/each}
						</select>

						<label for="transaction-amount">{m['labels.amount']()} (USD)</label>
						<input
							id="transaction-amount"
							name="amount"
							type="text"
							inputmode="decimal"
							autocomplete="off"
							pattern={AMOUNT_INPUT_PATTERN}
							required
						/>

						<label for="transaction-date">{m['labels.date']()}</label>
						<input
							id="transaction-date"
							name="bookedOn"
							type="date"
							defaultValue={todayDateOnly()}
							required
						/>

						{#if kind === 'income'}
							<label for="transaction-payment-method">{m['transactions.payment.method']()}</label>
							<select
								id="transaction-payment-method"
								name="paymentMethod"
								required
								{@attach syncPaymentMethod}
								onchange={(event) => syncPaymentMethod(event.currentTarget)}
							>
								<option value="cash">{m['transactions.payment.cash']()}</option>
								<option value="check">{m['transactions.payment.check']()}</option>
								<option value="transfer">{m['transactions.payment.transfer']()}</option>
								<option value="electronic">{m['transactions.payment.electronic']()}</option>
							</select>

							{#if showCheckFields}
								<label for="check-number">{m['transactions.check.number']()}</label>
								<input id="check-number" name="checkNumber" required />

								<label for="check-date">{m['transactions.check.date']()}</label>
								<input id="check-date" name="checkDate" type="date" required />
							{/if}
						{/if}

						<label for="transaction-memo">{m['labels.memo']()}</label>
						<textarea id="transaction-memo" name="memo"></textarea>
					{/if}
				{/snippet}
				{#snippet controls(form)}
					{#if form.state.matches('success')}
						<button type="reset">{m['transactions.add_another']()}</button>
					{:else}
						<button type="submit" disabled={form.disabled}>
							{form.busy ? m['transactions.saving']() : m['transactions.save']()}
						</button>
					{/if}
				{/snippet}
				{#snippet feedback(form)}
					{#if form.state.matches('success')}
						<p role="status">{m['transactions.saved']()}</p>
					{:else if form.state.matches('invalid')}
						<p role="alert">{m['transactions.validation_error']()}</p>
					{:else if form.state.matches('error')}
						<p role="alert">{m['transactions.save_error']()}</p>
					{/if}
				{/snippet}
			</Form>
		{/key}
	{/if}
</QueryContent>
