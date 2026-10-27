<script lang="ts">
	import { Button, FieldFeedback, InputCurrency, InputDate, Select } from 'delightful-ui'
	import { untrack } from 'svelte'
	import type { Account } from '#lib/schema.js'
	import type {
		InternalTransferEntryReason,
		InternalTransferEntryView
	} from '#lib/transfer-create-contract.js'
	import { AMOUNT_INPUT_PATTERN } from '#lib/domain/money.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'

	let {
		accounts,
		view,
		onsubmit,
		onreset,
		oninput,
		reasonText
	}: {
		accounts: readonly Account[]
		view: InternalTransferEntryView
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		oninput: (event: Event) => void
		reasonText: (reason: InternalTransferEntryReason) => string
	} = $props()
	let expenseAccountId = $state('')
	const draftRevision = $derived(view.draftRevision)
	$effect(() => {
		void draftRevision
		untrack(() => {
			expenseAccountId = accounts[0]?.id ?? ''
		})
	})
	const currency = $derived(
		accounts.find((account) => account.id === expenseAccountId)?.currency ?? 'USD'
	)
	function alertText() {
		if (view.readiness.kind === 'failed')
			return m['errors.load_subject']({ subject: m['nouns.transfer']({ count: 1 }) })
		if (view.feedback.kind !== 'result') return ''
		const result = view.feedback.result
		if (result.outcome === 'invalid') return m['transactions.validation_error']()
		if (result.outcome === 'denied' || result.outcome === 'unavailable')
			return reasonText(result.reason)
		if (result.outcome === 'failed')
			return m['errors.save_subject']({ subject: m['nouns.transfer']({ count: 1 }) })
		return ''
	}
	function fieldInvalid(path: string) {
		return (
			view.feedback.kind === 'result' &&
			view.feedback.result.outcome === 'invalid' &&
			view.feedback.result.issues.some((issue) => issue.path[0] === path)
		)
	}
</script>

<FormContent {view} {onsubmit} {onreset} {oninput}>
	{#snippet fields(form)}
		{#if form.content.kind !== 'success'}
			<Select
				label={m['transfers.source_subject']({ subject: m['nouns.account']({ count: 1 }) })}
				id="transfer-expense-account"
				name="expenseAccountId"
				required
				bind:value={expenseAccountId}
			>
				<option value="" disabled
					>{m['actions.select_subject']({ subject: m['nouns.account']({ count: 1 }) })}</option
				>
				{#each accounts as account (account.id)}
					<option value={account.id}>{account.name} · {account.currency}</option>
				{/each}
			</Select>
			<Select
				label={m['transfers.destination_subject']({ subject: m['nouns.account']({ count: 1 }) })}
				id="transfer-income-account"
				name="incomeAccountId"
				required
			>
				<option value="" disabled
					>{m['actions.select_subject']({ subject: m['nouns.account']({ count: 1 }) })}</option
				>
				{#each accounts as account (account.id)}
					<option value={account.id}>{account.name} · {account.currency}</option>
				{/each}
			</Select>
			<InputCurrency
				label={m['labels.amount']()}
				currencyLabel={currency}
				id="transfer-amount"
				name="amount"
				inputmode="decimal"
				autocomplete="off"
				pattern={AMOUNT_INPUT_PATTERN}
				aria-invalid={fieldInvalid('amount') || undefined}
				required
			/>
			<FieldFeedback
				id="transfer-amount-feedback"
				errorMessage={fieldInvalid('amount')
					? m['forms.enter_subject']({ subject: m['labels.amount']() })
					: ''}
			/>
			<InputDate
				label={m['nouns.date']({ count: 1 })}
				id="transfer-booked-on"
				name="bookedOn"
				defaultValue={todayDateOnly()}
				aria-invalid={fieldInvalid('bookedOn') || undefined}
				required
			/>
		{/if}
	{/snippet}
	{#snippet controls(form)}
		{#if form.content.kind === 'success'}
			<Button type="reset"
				>{m['actions.add_another_subject']({ subject: m['nouns.transfer']({ count: 1 }) })}</Button
			>
		{:else}
			<Button type="submit" variant="primary" disabled={!form.canSubmit}>
				{m['actions.save_subject']({ subject: m['nouns.transfer']({ count: 1 }) })}
			</Button>
		{/if}
	{/snippet}
	{#snippet feedback()}
		{#if view.feedback.kind === 'result' && view.feedback.result.outcome === 'succeeded'}
			<p role="status">
				{m['status.saved_subject']({ subject: m['nouns.transfer']({ count: 1 }) })}
			</p>
		{:else}<p role="alert" aria-live="assertive" aria-atomic="true">{alertText()}</p>{/if}
	{/snippet}
</FormContent>
