<script lang="ts">
	import { Button, InputText, Select } from 'delightful-ui'
	import type { z } from 'zod'
	import type { Account } from '#lib/schema.js'
	import type { FormController } from '#lib/forms.svelte.js'
	import type { accountFormSchema } from '#lib/validation/accounts.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'

	let {
		organizationId,
		form
	}: {
		organizationId: string | null
		form: FormController<
			z.output<typeof accountFormSchema>,
			Account,
			{ organizationId: string | null }
		>
	} = $props()
</script>

{#key organizationId}
	<FormContent view={form.view} onsubmit={form.submit} onreset={form.reset}>
		{#snippet fields(form)}
			{#if !form.state.matches('success')}
				<InputText
					label={m['labels.account_name']()}
					id="account-name"
					name="name"
					required
					disabled={form.busy}
				/>

				<Select
					label={m['labels.account_type']()}
					id="account-kind"
					name="kind"
					required
					disabled={form.busy}
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
		{#snippet controls(form)}
			{#if !form.state.matches('success')}
				<Button type="submit" disabled={form.disabled}>
					{form.busy
						? m['status.saving']({ subject: m['labels.account']() })
						: m['actions.add_account']()}
				</Button>
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
	</FormContent>
{/key}
