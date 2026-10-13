<script lang="ts">
	import { Button, InputText, Select } from 'delightful-ui'
	import { getDb } from 'jazz-tools/svelte'
	import type { z } from 'zod'
	import { createCategory } from '#lib/data.js'
	import type { Category } from '#lib/schema.js'
	import type { FormSave } from '#lib/machines/form.js'
	import { categoryFormSchema } from '#lib/validation/categories.js'
	import { m } from '#lib/paraglide/messages.js'
	import Form from './Form.svelte'

	let { organizationId, canCreate }: { organizationId: string; canCreate: boolean } = $props()
	const db = getDb()
	const save: FormSave<
		z.output<typeof categoryFormSchema>,
		Category,
		{ organizationId: string }
	> = async (values, { context, signal }) => {
		signal.throwIfAborted()
		if (!canCreate || context.organizationId !== organizationId)
			throw new Error('The workspace is not editable.')
		return createCategory(db, context.organizationId, values.name, values.kind)
	}
</script>

{#key organizationId}
	<Form schema={categoryFormSchema} {save} context={{ organizationId }} disabled={!canCreate}>
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
	</Form>
{/key}
