<script lang="ts">
	import { InputText, Select } from 'delightful-ui'
	import type { Category } from '#lib/schema.js'
	import type { ManagementView, ManagementScope } from '#lib/management-contract.js'
	import { m } from '#lib/paraglide/messages.js'
	import { formReasonText } from '#lib/form-messages.js'
	import FormModal from './FormModal.svelte'
	import FormFeedback from './FormFeedback.svelte'
	let {
		scope,
		view,
		onopen,
		onsubmit,
		onreset,
		onRetryReadiness
	}: {
		scope: ManagementScope
		view: ManagementView<Category>
		onopen: () => void
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		onRetryReadiness: () => void
	} = $props()
</script>

<FormFeedback
	{view}
	subject={m['labels.category']()}
	reasonText={(reason) => formReasonText[reason]()}
	invalidMessage={m['categories.validation_error']()}
	section="readiness"
	{onRetryReadiness}
/>
<FormModal
	{scope}
	label={m['actions.add']({ name: m['labels.category']() })}
	{view}
	{onopen}
	{onsubmit}
	{onreset}
>
	{#snippet fields(form)}
		<InputText
			label={m['labels.category_name']()}
			id="category-name"
			name="name"
			required
			disabled={!form.fieldsEditable}
		/>
		<Select
			label={m['labels.transaction_type']()}
			id="category-kind"
			name="kind"
			required
			disabled={!form.fieldsEditable}
			defaultValue="expense"
		>
			<option value="expense">{m['labels.expenses']()}</option>
			<option value="income">{m['labels.income']()}</option>
		</Select>
	{/snippet}
	{#snippet feedback(view)}
		<FormFeedback
			{view}
			subject={m['labels.category']()}
			reasonText={(reason) => formReasonText[reason]()}
			invalidMessage={m['categories.validation_error']()}
			successMessage={(value) =>
				m['actions.saved']({ subject: m['labels.category'](), name: value.name })}
			section="all"
		/>
	{/snippet}
</FormModal>
