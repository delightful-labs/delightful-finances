<script lang="ts">
	import { InputText, Select } from 'delightful-ui'
	import type { Tag, Category } from '#lib/schema.js'
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
		onRetryReadiness,
		categories
	}: {
		scope: ManagementScope
		view: ManagementView<Tag>
		onopen: () => void
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		onRetryReadiness: () => void
		categories: readonly Category[]
	} = $props()
</script>

<FormFeedback
	{view}
	subject={m['labels.tag']()}
	reasonText={(reason) => formReasonText[reason]()}
	invalidMessage={m['tags.validation_error']()}
	section="readiness"
	{onRetryReadiness}
/>
<FormModal
	{scope}
	label={m['actions.add']({ name: m['labels.tag']() })}
	{view}
	{onopen}
	{onsubmit}
	{onreset}
>
	{#snippet fields(form)}
		<InputText
			label={m['labels.tag_name']()}
			id="tag-name"
			name="name"
			required
			disabled={!form.fieldsEditable}
		/>
		<Select
			label={m['labels.category']()}
			id="tag-category"
			name="categoryId"
			defaultValue=""
			disabled={!form.fieldsEditable}
		>
			<option value="">{m['tags.no_category']()}</option>
			{#each categories as category (category.id)}
				<option value={category.id}
					>{category.name} ({category.kind === 'expense'
						? m['labels.expenses']()
						: m['labels.income']()})</option
				>
			{/each}
		</Select>
	{/snippet}
	{#snippet feedback(view)}
		<FormFeedback
			{view}
			subject={m['labels.tag']()}
			reasonText={(reason) => formReasonText[reason]()}
			invalidMessage={m['tags.validation_error']()}
			successMessage={(value) =>
				m['actions.saved_with_name']({ subject: m['labels.tag'](), name: value.name })}
			section="all"
		/>
	{/snippet}
</FormModal>
