<script lang="ts">
	import { Button, Text, InputAvatar } from 'delightful-ui'
	import { avatarMimeType } from '#lib/validation/identity.js'
	import type { ProfileView } from '#lib/profile-contract.js'
	import FormFeedback from './FormFeedback.svelte'
	import { formReasonText } from '#lib/form-messages.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'
	let {
		profileId,
		avatarData,
		mimeType,
		view,
		onsubmit,
		onreset,
		oninput,
		onRetryReadiness,
		onRemove,
		onSelectionChange
	}: {
		profileId: string
		avatarData: Uint8Array | null | undefined
		mimeType: string | null | undefined
		view: ProfileView
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		oninput: (event: Event) => void
		onRetryReadiness: () => void
		onRemove: () => void
		onSelectionChange: (file: File | null) => void
	} = $props()
	let savedFile = $state<File | null>(null)
	let selectedFile = $state<File | null>(null)
	const resetRevision = $derived(view.draftRevision)
	const recordId = $derived(profileId)
	$effect(() => {
		void recordId
		void resetRevision
		const file =
			avatarData && mimeType
				? new File([Uint8Array.from(avatarData)], 'avatar', { type: mimeType })
				: null
		savedFile = file
		selectedFile = file
	})
</script>

<Text id="avatar-help">{m['profile.avatar_description']()}</Text>
<FormFeedback
	{view}
	subject={m['labels.profile']()}
	reasonText={(reason) => formReasonText[reason]()}
	invalidMessage={m['profile.name_invalid']()}
	section="readiness"
	{onRetryReadiness}
/>
{#key profileId}
	<FormContent {view} {onsubmit} {onreset} {oninput}>
		{#snippet fields(view)}
			<input type="hidden" name="action" value="upload" />
			<InputAvatar
				label={m['labels.avatar']()}
				uploadLabel={m['actions.choose_image']()}
				bind:value={
					() => selectedFile,
					(file) => {
						if (file === null && selectedFile === savedFile && savedFile !== null) {
							onRemove()
							return
						}
						selectedFile = file ?? savedFile
						onSelectionChange(file)
					}
				}
				removeLabel={selectedFile === savedFile
					? m['actions.remove_avatar']()
					: m['actions.clear_selected_image']()}
				id="profile-avatar"
				name="file"
				accept={avatarMimeType.options.join(',')}
				aria-describedby="avatar-help"
				required
				disabled={!view.fieldsEditable}
			/>
		{/snippet}
		{#snippet controls(view)}
			{#if selectedFile && selectedFile !== savedFile}
				<Button type="submit" disabled={!view.canSubmit}>
					{m['actions.save_subject']({ subject: m['labels.avatar']() })}
				</Button>
			{/if}
		{/snippet}
		{#snippet feedback(view)}
			<FormFeedback
				{view}
				subject={m['labels.profile']()}
				reasonText={(reason) => formReasonText[reason]()}
				invalidMessage={m['profile.avatar_invalid']()}
				successMessage={() =>
					m['actions.saved_with_name']({
						subject: m['labels.profile'](),
						name: m['labels.avatar']()
					})}
				section="result"
			/>
		{/snippet}
	</FormContent>
{/key}
