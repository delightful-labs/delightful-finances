<script lang="ts">
	import type { Snippet } from 'svelte'
	import { InputText, Select } from 'delightful-ui'
	import type { z } from 'zod'
	import type { Account } from '#lib/schema.js'
	import type { FormController } from '#lib/forms.svelte.js'
	import type { accountFormSchema } from '#lib/validation/accounts.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormModal from './FormModal.svelte'

	let {
		organizationId,
		scope = organizationId,
		form,
		trigger
	}: {
		organizationId: string | null
		scope?: string | null
		trigger?: Snippet<[() => void, boolean]> | undefined
		form: FormController<
			z.output<typeof accountFormSchema>,
			Account,
			{ organizationId: string | null }
		>
	} = $props()
	const formId = $props.id()
</script>

<FormModal
	{scope}
	{trigger}
	label={m['actions.add_account']()}
	savingLabel={m['status.saving']({ subject: m['labels.account']() })}
	disabled={form.view.disabled}
	view={form.view}
	onsubmit={form.submit}
	onreset={form.reset}
>
	{#snippet fields(form)}
		{#if !form.state.matches('success')}
			<InputText
				label={m['labels.account_name']()}
				id={`${formId}-name`}
				name="name"
				required
				disabled={form.disabled}
			/>

			<Select
				label={m['labels.account_type']()}
				id={`${formId}-kind`}
				name="kind"
				required
				disabled={form.disabled}
				defaultValue=""
			>
				<option value="" disabled>{m['labels.account_type']()}</option>
				<option value="cash">{m['accounts.type.cash']()}</option>
				<option value="bank">{m['accounts.type.bank']()}</option>
				<option value="card">{m['accounts.type.card']()}</option>
			</Select>

			<p>{m['accounts.currency_usd']()}</p>
		{/if}
	{/snippet}
	{#snippet feedback(form)}
		{#if form.state.matches('success') && form.state.context.result}
			<p role="status">{m['accounts.saved']({ name: form.state.context.result.name })}</p>
		{:else if form.state.matches('invalid')}
			<p role="alert">{m['accounts.validation_error']()}</p>
		{:else if form.state.matches('error')}
			<p role="alert">{m['errors.save']({ subject: m['labels.account']() })}</p>
		{/if}
	{/snippet}
</FormModal>
