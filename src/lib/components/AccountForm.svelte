<script lang="ts">
	import { getContext } from 'svelte'
	import { getDb } from 'jazz-tools/svelte'
	import type { z } from 'zod'
	import { createAccount } from '#lib/data.js'
	import type { Account } from '#lib/schema.js'
	import type { FormSave } from '#lib/machines/form.js'
	import { accountFormSchema } from '#lib/validation/accounts.js'
	import { m } from '#lib/paraglide/messages.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import Form from './Form.svelte'

	const db = getDb()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const save: FormSave<
		z.output<typeof accountFormSchema>,
		Account,
		{ organizationId: string | null }
	> = async (values, { context, signal }) => {
		signal.throwIfAborted()
		if (!context.organizationId || context.organizationId !== filters.activeOrganizationId)
			throw new Error('No matching workspace is selected.')
		return createAccount(db, context.organizationId, values.name, values.kind)
	}
</script>

<svelte:head>
	<title>{m['actions.add_account']()} · {m['app.name']()}</title>
</svelte:head>

<h1>{m['actions.add_account']()}</h1>

{#key filters.activeOrganizationId}
	<Form
		schema={accountFormSchema}
		{save}
		context={{ organizationId: filters.activeOrganizationId }}
		disabled={!filters.activeOrganizationId}
	>
		{#snippet fields(form)}
			{#if !form.state.matches('success')}
				<label for="account-name">{m['labels.account_name']()}</label>
				<input id="account-name" name="name" required disabled={form.busy} />

				<label for="account-kind">{m['labels.account_type']()}</label>
				<select id="account-kind" name="kind" required disabled={form.busy}>
					<option value="" selected disabled>{m['labels.account_type']()}</option>
					<option value="cash">{m['accounts.type.cash']()}</option>
					<option value="bank">{m['accounts.type.bank']()}</option>
					<option value="card">{m['accounts.type.card']()}</option>
				</select>

				<p>{m['accounts.currency_usd']()}</p>
			{/if}
		{/snippet}
		{#snippet controls(form)}
			{#if !form.state.matches('success')}
				<button type="submit" disabled={form.disabled}>
					{form.busy ? m['accounts.saving']() : m['actions.add_account']()}
				</button>
			{/if}
		{/snippet}
		{#snippet feedback(form)}
			{#if form.state.matches('success') && form.state.context.result}
				<p role="status">{m['accounts.saved']({ name: form.state.context.result.name })}</p>
			{:else if form.state.matches('invalid')}
				<p role="alert">{m['accounts.validation_error']()}</p>
			{:else if form.state.matches('error')}
				<p role="alert">{m['accounts.save_error']()}</p>
			{/if}
		{/snippet}
	</Form>
{/key}
