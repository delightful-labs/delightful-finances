<script lang="ts">
	import { Button, InputText, InputDate, Select, Textarea } from 'delightful-ui'
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
	loadingMessage={m['status.loading']({ subject: m['labels.accounts_and_categories']() })}
	errorMessage={m['errors.load']({ subject: m['labels.accounts_and_categories']() })}
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

						{#key defaultCategory?.id}
							<Select
								label={m['labels.category']()}
								id="transaction-category"
								name="categoryId"
								required
								defaultValue={defaultCategory?.id ?? ''}
							>
								<option value="" disabled>
									{m['transactions.select_category']()}
								</option>
								{#each availableCategories as category (category.id)}
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
			</Form>
		{/key}
	{/if}
</QueryContent>
