<script lang="ts">
	import { INCOME, EXPENSE } from '#lib/domain/transaction-kind.js'
	import type { Snippet } from 'svelte'
	import { InputText, Select } from 'delightful-ui'
	import type { Tag, Category } from '#lib/schema.js'
	import type { ManagementView } from '#lib/contracts/management-contract.js'
	import { m } from '#lib/paraglide/messages.js'
	import { formReasonText } from '#lib/forms/form-messages.js'
	import FormModal from '../forms/FormModal.svelte'
	import FormFeedback from '../forms/FormFeedback.svelte'
	let {
		scope,
		view,
		onopen,
		onsubmit,
		onreset,
		onRetryReadiness,
		categories,
		categoriesProjected = false,
		projectedKind,
		onKindChange,
		categoryOptionsControls
	}: {
		scope: unknown
		view: ManagementView<Tag>
		onopen: () => void
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		onRetryReadiness: () => void
		categories: readonly Category[]
		categoriesProjected?: boolean
		projectedKind?: 'income' | 'expense' | undefined
		onKindChange?: ((kind: 'income' | 'expense') => void) | undefined
		categoryOptionsControls?: Snippet<[string]> | undefined
	} = $props()
	let kind = $state<string>(EXPENSE)
	let categoryId = $state('')
	const draftRevision = $derived(view.draftRevision)
	$effect(() => {
		void scope
		void draftRevision
		kind = EXPENSE
		categoryId = ''
	})
</script>

<FormFeedback
	{view}
	subject={m['nouns.tag']({ count: 1 })}
	reasonText={(reason) => formReasonText[reason]()}
	invalidMessage={m['forms.enter_subject']({
		subject: m['labels.subject_name']({ subject: m['nouns.tag']({ count: 1 }) })
	})}
	section="readiness"
	{onRetryReadiness}
/>
<FormModal
	{scope}
	label={m['actions.add_subject']({ subject: m['nouns.tag']({ count: 1 }) })}
	{view}
	{onopen}
	{onsubmit}
	{onreset}
>
	{#snippet fields(form)}
		<InputText
			label={m['labels.subject_name']({ subject: m['nouns.tag']({ count: 1 }) })}
			id="tag-name"
			name="name"
			required
			disabled={!form.fieldsEditable}
		/>
		<Select
			label={m['labels.subject_type']({ subject: m['nouns.transaction']({ count: 1 }) })}
			id="tag-kind"
			name="kind"
			required
			defaultValue={EXPENSE}
			bind:value={kind}
			disabled={!form.fieldsEditable}
			onchange={(event) => {
				categoryId = ''
				if (!(event.currentTarget instanceof HTMLSelectElement)) return
				const selected = event.currentTarget.value
				if (selected === INCOME || selected === EXPENSE) onKindChange?.(selected)
			}}
		>
			<option value={EXPENSE}>{m['nouns.expense']({ count: 2 })}</option>
			<option value={INCOME}>{m['nouns.income']({ count: 1 })}</option>
		</Select>
		<p>
			{m['forms.select_subject']({
				subject: m['labels.subject_type']({ subject: m['nouns.transaction']({ count: 1 }) })
			})}
		</p>
		<Select
			label={m['nouns.category']({ count: 1 })}
			id="tag-category"
			name="categoryId"
			defaultValue=""
			bind:value={categoryId}
			disabled={!form.fieldsEditable}
		>
			<option value=""
				>{m['labels.no_subject']({ subject: m['nouns.category']({ count: 1 }) })}</option
			>
			{#each categoriesProjected ? (projectedKind === undefined || projectedKind === kind ? categories : []) : categories.filter((category) => category.kind === kind) as category (category.id)}
				<option value={category.id}
					>{category.name} ({category.kind === EXPENSE
						? m['nouns.expense']({ count: 2 })
						: m['nouns.income']({ count: 1 })})</option
				>
			{/each}
		</Select>
		{@render categoryOptionsControls?.(kind)}
	{/snippet}
	{#snippet feedback(view)}
		<FormFeedback
			{view}
			subject={m['nouns.tag']({ count: 1 })}
			reasonText={(reason) => formReasonText[reason]()}
			invalidMessage={m['forms.enter_subject']({
				subject: m['labels.subject_name']({ subject: m['nouns.tag']({ count: 1 }) })
			})}
			successMessage={(value) =>
				m['status.saved_subject_name']({ subject: m['nouns.tag']({ count: 1 }), name: value.name })}
			section="all"
		/>
	{/snippet}
</FormModal>
