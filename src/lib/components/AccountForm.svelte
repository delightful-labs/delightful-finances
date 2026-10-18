<script lang="ts">
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
		selectWorkspace: () => m['workspace.select_workspace'](),
		loadFailed: () => m['errors.load']({ subject: m['labels.accounts']() }),
		loading: () => m['status.loading']({ subject: m['labels.accounts']() }),
		readOnly: () => m['accounts.create_restricted']()
	}
</script>

<FormFeedback
	{view}
	subject={m['labels.account']()}
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
	label={m['actions.add']({ name: m['labels.account']() })}
>
	{#snippet fields(form)}
		<InputText
			label={m['labels.account_name']()}
			id={`${formId}-name`}
			name="name"
			required
			disabled={!form.fieldsEditable}
		/>
		<Select
			label={m['labels.account_type']()}
			id={`${formId}-kind`}
			name="kind"
			required
			disabled={!form.fieldsEditable}
			defaultValue=""
		>
			<option value="" disabled>{m['labels.account_type']()}</option>
			<option value="cash">{m['accounts.type.cash']()}</option>
			<option value="bank">{m['accounts.type.bank']()}</option>
			<option value="card">{m['accounts.type.card']()}</option>
		</Select>
		<p>{m['accounts.currency_usd']()}</p>
	{/snippet}
	{#snippet feedback(view)}
		<FormFeedback
			{view}
			subject={m['labels.account']()}
			reasonText={(reason) => explanations[reason]()}
			invalidMessage={m['accounts.validation_error']()}
			successMessage={(value) =>
				m['actions.saved']({ subject: m['labels.account'](), name: value.name })}
		/>
	{/snippet}
</FormModal>
