<script lang="ts">
	import { InputText, Select } from 'delightful-ui'
	import type { z } from 'zod'
	import type { Category } from '#lib/schema.js'
	import type { FormController } from '#lib/forms.svelte.js'
	import type { categoryFormSchema } from '#lib/validation/categories.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormModal from './FormModal.svelte'

	let {
		organizationId,
		canCreate,
		form
	}: {
		organizationId: string
		canCreate: boolean
		form: FormController<
			z.output<typeof categoryFormSchema>,
			Category,
			{ organizationId: string | null }
		>
	} = $props()
</script>

<FormModal
	scope={organizationId}
	label={m['actions.add']({ name: m['labels.category']() })}
	savingLabel={m['status.saving']({ subject: m['labels.category']() })}
	disabled={!canCreate}
	view={form.view}
	onsubmit={form.submit}
	onreset={form.reset}
>
	{#snippet fields(form)}
		{#if !form.state.matches('success')}
			<InputText
				label={m['labels.category_name']()}
				id="category-name"
				name="name"
				required
				disabled={form.busy || !canCreate}
			/>
			<Select
				label={m['labels.transaction_type']()}
				id="category-kind"
				name="kind"
				required
				disabled={form.busy || !canCreate}
				defaultValue="expense"
			>
				<option value="expense">{m['labels.expenses']()}</option>
				<option value="income">{m['labels.income']()}</option>
			</Select>
		{/if}
	{/snippet}
	{#snippet feedback(form)}
		{#if form.state.matches('success') && form.state.context.result}
			<p role="status">
				{m['actions.saved']({
					subject: m['labels.category'](),
					name: form.state.context.result.name
				})}
			</p>
		{:else if form.state.matches('invalid')}
			<p role="alert">{m['categories.validation_error']()}</p>
		{:else if form.state.matches('error')}
			<p role="alert">{m['errors.save']({ subject: m['labels.category']() })}</p>
		{/if}
	{/snippet}
</FormModal>
