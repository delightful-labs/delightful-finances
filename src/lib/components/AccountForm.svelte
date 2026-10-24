<script lang="ts">
	import { ACCOUNT_KIND } from '#lib/domain/account-kind.js'
	import type { Snippet } from 'svelte'
	import { InputText, Select } from 'delightful-ui'
	import type {
		AccountCreationReason,
		AccountCreationScope,
		AccountCreationView
	} from '#lib/account-creation-contract.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormModal from './FormModal.svelte'
	import FormFeedback from './FormFeedback.svelte'
	let {
		scope,
		view,
		trigger,
		onopen,
		onsubmit,
		onreset,
		onRetryReadiness
	}: {
		scope: AccountCreationScope
		view: AccountCreationView
		trigger?: Snippet<[() => void, boolean]> | undefined
		onopen: () => void
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		onRetryReadiness: () => void
	} = $props()
	const formId = $props.id()
	const explanations: Record<AccountCreationReason, () => string> = {
		sessionUnavailable: () => m['accounts.create_session_unavailable'](),
		selectWorkspace: () =>
			m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) }),
		loadFailed: () => m['errors.load_subject']({ subject: m['nouns.account']({ count: 2 }) }),
		loading: () => m['status.loading_subject']({ subject: m['nouns.account']({ count: 2 }) }),
		duplicateName: () => m['forms.duplicate_name'](),
		readOnly: () => m['accounts.create_restricted']()
	}
</script>

<FormFeedback
	{view}
	subject={m['nouns.account']({ count: 1 })}
	reasonText={(reason) => explanations[reason]()}
	invalidMessage={m['accounts.validation_error']()}
	section="readiness"
	{onRetryReadiness}
/>
<FormModal
	{scope}
	{trigger}
	{view}
	{onopen}
	{onsubmit}
	{onreset}
	label={m['actions.add_subject']({ subject: m['nouns.account']({ count: 1 }) })}
>
	{#snippet fields(form)}
		<InputText
			label={m['labels.subject_name']({ subject: m['nouns.account']({ count: 1 }) })}
			id={`${formId}-name`}
			name="name"
			required
			disabled={!form.fieldsEditable}
		/>
		<Select
			label={m['labels.subject_type']({ subject: m['nouns.account']({ count: 1 }) })}
			id={`${formId}-kind`}
			name="kind"
			required
			disabled={!form.fieldsEditable}
			defaultValue=""
		>
			<option value="" disabled
				>{m['actions.select_subject']({
					subject: m['labels.subject_type']({ subject: m['nouns.account']({ count: 1 }) })
				})}</option
			>
			<option value={ACCOUNT_KIND.CASH}>{m['labels.cash']()}</option>
			<option value={ACCOUNT_KIND.BANK}>{m['accounts.type.bank']()}</option>
			<option value={ACCOUNT_KIND.CARD}>{m['accounts.type.card']()}</option>
		</Select>
		<p>{m['labels.currency_code']({ code: 'USD' })}</p>
	{/snippet}
	{#snippet feedback(view)}
		<FormFeedback
			{view}
			subject={m['nouns.account']({ count: 1 })}
			reasonText={(reason) => explanations[reason]()}
			invalidMessage={m['accounts.validation_error']()}
			successMessage={(value) =>
				m['status.saved_subject_name']({
					subject: m['nouns.account']({ count: 1 }),
					name: value.name
				})}
		/>
	{/snippet}
</FormModal>
