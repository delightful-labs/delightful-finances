<script lang="ts">
	import { Button, Heading, Text, InputText } from 'delightful-ui'
	import type { ProfileView } from '#lib/contracts/profile-contract.js'
	import FormFeedback from './FormFeedback.svelte'
	import { formReasonText } from '#lib/form-messages.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'
	let {
		profileId,
		displayName,
		view,
		onsubmit,
		onreset,
		oninput,
		onRetryReadiness
	}: {
		profileId: string
		displayName: string | null | undefined
		view: ProfileView
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		oninput: (event: Event) => void
		onRetryReadiness: () => void
	} = $props()
</script>

<Heading level="h2">{m['nouns.profile']({ count: 1 })}</Heading>
<Text>{m['profile.name_description']()}</Text>
<FormFeedback
	{view}
	subject={m['nouns.profile']({ count: 1 })}
	reasonText={(reason) => formReasonText[reason]()}
	invalidMessage={m['profile.name_invalid']()}
	section="readiness"
	{onRetryReadiness}
/>
{#key profileId}
	<FormContent {view} {onsubmit} {onreset} {oninput}>
		{#snippet fields(view)}
			<InputText
				label={m['labels.display_name']()}
				id="profile-display-name"
				name="displayName"
				value={displayName ?? ''}
				disabled={!view.fieldsEditable}
				autocomplete="nickname"
			/>
		{/snippet}
		{#snippet controls(view)}
			<Button type="submit" disabled={!view.canSubmit}>{m['actions.save']()}</Button>
		{/snippet}
		{#snippet feedback(view)}
			<FormFeedback
				{view}
				subject={m['nouns.profile']({ count: 1 })}
				reasonText={(reason) => formReasonText[reason]()}
				invalidMessage={m['profile.name_invalid']()}
				successMessage={() =>
					m['status.saved_subject_name']({
						subject: m['nouns.profile']({ count: 1 }),
						name: m['labels.display_name']()
					})}
				section="result"
			/>
		{/snippet}
	</FormContent>
{/key}
