<script lang="ts">
	import { Button, InputText, Select } from 'delightful-ui'
	import type { z } from 'zod'
	import type { Category } from '#lib/schema.js'
	import type { FormController } from '#lib/controllers/form.svelte.js'
	import type { categoryFormSchema } from '#lib/validation/categories.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'

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

{#key organizationId}
	<FormContent view={form.view} onsubmit={form.submit} onreset={form.reset}>
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
		{#snippet controls(form)}
			{#if form.state.matches('success')}
				<Button type="reset" disabled={!canCreate}>{m['actions.add_category']()}</Button>
			{:else}
				<Button type="submit" disabled={form.disabled}
					>{form.busy
						? m['status.saving']({ subject: m['labels.category']() })
						: m['actions.add_category']()}</Button
				>
			{/if}
		{/snippet}
		{#snippet feedback(form)}
			{#if form.state.matches('success') && form.state.context.result}
				<p role="status">{m['categories.saved']({ name: form.state.context.result.name })}</p>
			{:else if form.state.matches('invalid')}
				<p role="alert">{m['categories.validation_error']()}</p>
			{:else if form.state.matches('error')}
				<p role="alert">{m['errors.save']({ subject: m['labels.category']() })}</p>
			{/if}
		{/snippet}
	</FormContent>
{/key}
