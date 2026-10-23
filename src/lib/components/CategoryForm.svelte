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
	subject={m['nouns.category']({ count: 1 })}
	reasonText={(reason) => formReasonText[reason]()}
	invalidMessage={m['categories.validation_error']()}
	section="readiness"
	{onRetryReadiness}
/>
<FormModal
	{scope}
	label={m['actions.add_subject']({ subject: m['nouns.category']({ count: 1 }) })}
	{view}
	{onopen}
	{onsubmit}
	{onreset}
>
	{#snippet fields(form)}
		<InputText
			label={m['labels.subject_name']({ subject: m['nouns.category']({ count: 1 }) })}
			id="category-name"
			name="name"
			required
			disabled={!form.fieldsEditable}
		/>
		<Select
			label={m['labels.subject_type']({ subject: m['nouns.transaction']({ count: 1 }) })}
			id="category-kind"
			name="kind"
			required
			disabled={!form.fieldsEditable}
			defaultValue="expense"
		>
			<option value="expense">{m['nouns.expense']({ count: 2 })}</option>
			<option value="income">{m['nouns.income']({ count: 1 })}</option>
		</Select>
	{/snippet}
	{#snippet feedback(view)}
		<FormFeedback
			{view}
			subject={m['nouns.category']({ count: 1 })}
			reasonText={(reason) => formReasonText[reason]()}
			invalidMessage={m['categories.validation_error']()}
			successMessage={(value) =>
				m['status.saved_subject_name']({
					subject: m['nouns.category']({ count: 1 }),
					name: value.name
				})}
			section="all"
		/>
	{/snippet}
</FormModal>
