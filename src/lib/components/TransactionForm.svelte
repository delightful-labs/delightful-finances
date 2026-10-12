<script lang="ts">
	import { getContext, onMount } from 'svelte'
	import { useMachine } from '@xstate/svelte'
	import { getDb } from 'jazz-tools/svelte'
	import { createTransaction } from '#lib/data.js'
	import { AMOUNT_INPUT_PATTERN, parseAmountMinor } from '#lib/domain/money.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import type { IncomePaymentMethod } from '#lib/domain/transaction.js'
	import { app, type Account, type Category } from '#lib/schema.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import { transactionFormMachine } from '#lib/machines/transactionForm.js'

	let allAccounts = $state<Account[]>([])
	let allCategories = $state<Category[]>([])
	let accountLoadError = $state(false)
	let categoryLoadError = $state(false)
	let selectionError = $state(false)
	const db = getDb()
	let { kind }: { kind: 'expense' | 'income' } = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const accounts = $derived(
		allAccounts.filter((account) => account.organizationId === filters.activeOrganizationId)
	)
	const dataLoadError = $derived(accountLoadError || categoryLoadError)
	const availableCategories = $derived(
		allCategories.filter(
			(category) =>
				category.organizationId === filters.activeOrganizationId &&
				category.kind === kind &&
				category.archivedAt == null
		)
	)

	const { snapshot, send } = useMachine(transactionFormMachine, {
		input: {
			draft: {},
			save: (transaction) => createTransaction(db, transaction)
		}
	})

	onMount(() => {
		const unsubscribeAccounts = db.subscribe(app.accounts.orderBy('name'), {
			onUpdate: (rows) => {
				allAccounts = rows.filter((account) => account.archivedAt == null)
				accountLoadError = false
			},
			onError: () => {
				accountLoadError = true
			}
		})
		const unsubscribeCategories = db.subscribe(app.categories.orderBy('name'), {
			onUpdate: (rows) => {
				allCategories = rows
				categoryLoadError = false
			},
			onError: () => {
				categoryLoadError = true
			}
		})

		return () => {
			unsubscribeAccounts()
			unsubscribeCategories()
		}
	})

	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		const formData = new FormData(event.currentTarget)
		const accountId = String(formData.get('accountId') ?? '')
		const categoryId = String(formData.get('categoryId') ?? '')
		const selectedAccount = accounts.find((account) => account.id === accountId)
		const selectedCategory = availableCategories.find((category) => category.id === categoryId)
		if (
			!selectedAccount ||
			!selectedCategory ||
			selectedCategory.organizationId !== selectedAccount.organizationId
		) {
			selectionError = true
			return
		}
		selectionError = false
		const amountText = String(formData.get('amount') ?? '')
		const parsedAmount = parseAmountMinor(amountText)
		const paymentMethodValue = String(formData.get('paymentMethod') ?? 'cash')
		const paymentMethod: IncomePaymentMethod =
			paymentMethodValue === 'check' ||
			paymentMethodValue === 'transfer' ||
			paymentMethodValue === 'electronic'
				? paymentMethodValue
				: 'cash'
		const transactionBase = {
			accountId,
			organizationId: selectedAccount?.organizationId ?? '',
			categoryId,
			bookedOn: String(formData.get('bookedOn') ?? ''),
			money: {
				amountMinor: parsedAmount.kind === 'valid' ? parsedAmount.amountMinor : amountText,
				currency: selectedAccount?.currency ?? ''
			},
			...(String(formData.get('memo') ?? '').trim()
				? { memo: String(formData.get('memo')).trim() }
				: {})
		}
		const transactionDraft =
			kind === 'expense'
				? { ...transactionBase, kind, source: { source: 'manual' } }
				: paymentMethod === 'check'
					? {
							...transactionBase,
							kind,
							source: { source: 'manual' },
							paymentMethod,
							checkDetails: {
								checkNumber: String(formData.get('checkNumber') ?? ''),
								...(String(formData.get('checkDate') ?? '')
									? { checkDate: String(formData.get('checkDate')) }
									: {})
							}
						}
					: { ...transactionBase, kind, source: { source: 'manual' }, paymentMethod }

		send({ type: 'UPDATE_DRAFT', draft: transactionDraft })
		send({ type: 'SUBMIT' })
	}

	function resetForm() {
		send({ type: 'RESET' })
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

{#if dataLoadError}
	<p role="alert">{m['transactions.data_load_error']()}</p>
{/if}

{#if accounts.length === 0}
	<p>{m['transactions.no_accounts']()}</p>
{:else if $snapshot.matches('success')}
	<p role="status">{m['transactions.saved']()}</p>
	<button type="button" onclick={resetForm}>{m['transactions.add_another']()}</button>
{:else}
	<form onsubmit={submit}>
		<label for="transaction-account">{m['labels.account']()}</label>
		<select id="transaction-account" name="accountId" required>
			<option value="" selected disabled>{m['transactions.select_account']()}</option>
			{#each accounts as account (account.id)}
				<option value={account.id}>{account.name}</option>
			{/each}
		</select>

		<label for="transaction-category">{m['labels.category']()}</label>
		<select id="transaction-category" name="categoryId" required>
			<option value="" selected disabled>{m['transactions.select_category']()}</option>
			{#each availableCategories as category (category.id)}
				<option value={category.id}>{category.name}</option>
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
		<input id="transaction-date" name="bookedOn" type="date" value={todayDateOnly()} required />

		{#if kind === 'income'}
			<label for="transaction-payment-method">{m['transactions.payment.method']()}</label>
			<select id="transaction-payment-method" name="paymentMethod" required>
				<option value="cash">{m['transactions.payment.cash']()}</option>
				<option value="check">{m['transactions.payment.check']()}</option>
				<option value="transfer">{m['transactions.payment.transfer']()}</option>
				<option value="electronic">{m['transactions.payment.electronic']()}</option>
			</select>

			<label for="check-number">{m['transactions.check.number']()}</label>
			<input id="check-number" name="checkNumber" />

			<label for="check-date">{m['transactions.check.date']()}</label>
			<input id="check-date" name="checkDate" type="date" />
		{/if}

		<label for="transaction-memo">{m['labels.memo']()}</label>
		<textarea id="transaction-memo" name="memo"></textarea>

		{#if selectionError || $snapshot.context.validationIssues.length > 0}
			<p role="alert">{m['transactions.validation_error']()}</p>
		{/if}
		{#if $snapshot.matches('error')}
			<p role="alert">{m['transactions.save_error']()}</p>
		{/if}

		<button
			type="submit"
			disabled={$snapshot.matches('saving') || availableCategories.length === 0}
		>
			{$snapshot.matches('saving') ? m['transactions.saving']() : m['transactions.save']()}
		</button>
	</form>
{/if}
