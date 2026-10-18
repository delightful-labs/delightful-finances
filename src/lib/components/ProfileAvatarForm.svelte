<script lang="ts">
	import { Button, Text, InputAvatar, StatusMessage } from 'delightful-ui'
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
	let selectedFile = $state<File | null>(null)
	const resetRevision = $derived(view.draftRevision)
	const recordId = $derived(profileId)
	$effect(() => {
		void recordId
		void resetRevision
		selectedFile = null
	})

	let imageUrl = $state('')
	let imageFailed = $state(false)
	$effect(() => {
		imageFailed = false
		if (!avatarData || !mimeType) {
			imageUrl = ''
			return
		}
		const url = URL.createObjectURL(new Blob([Uint8Array.from(avatarData)], { type: mimeType }))
		imageUrl = url
		return () => URL.revokeObjectURL(url)
	})
</script>

<Text id="avatar-help">{m['profile.avatar_description']()}</Text>
{#if imageUrl && !imageFailed}
	<img
		src={imageUrl}
		alt={m['profile.avatar_alt']()}
		width="96"
		height="96"
		style:object-fit="contain"
		onerror={() => (imageFailed = true)}
	/>
{:else if imageFailed}
	<StatusMessage variant="error" text={m['profile.avatar_invalid']()} />
{/if}
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
						selectedFile = file
						onSelectionChange(file)
					}
				}
				removeLabel={m['actions.clear_selected_image']()}
				id="profile-avatar"
				name="file"
				accept={avatarMimeType.options.join(',')}
				aria-describedby="avatar-help"
				required
				disabled={!view.fieldsEditable}
			/>
		{/snippet}
		{#snippet controls(view)}
			{#if selectedFile}
				<Button type="submit" disabled={!view.canSubmit}>
					{m['actions.save_avatar']()}
				</Button>
			{/if}
			{#if avatarData}
				<Button type="button" disabled={!view.fieldsEditable} onclick={onRemove}
					>{m['actions.remove_avatar']()}</Button
				>
			{/if}
		{/snippet}
		{#snippet feedback(view)}
			<FormFeedback
				{view}
				subject={m['labels.profile']()}
				reasonText={(reason) => formReasonText[reason]()}
				invalidMessage={m['profile.avatar_invalid']()}
				successMessage={() => m['profile.avatar_saved']()}
				section="result"
			/>
		{/snippet}
	</FormContent>
{/key}
