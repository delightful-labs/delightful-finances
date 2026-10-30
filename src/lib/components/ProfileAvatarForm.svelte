<script lang="ts">
	import { Button, Dialog, Text, InputAvatar } from 'delightful-ui'
	import { avatarMimeType, profileAvatarFormSchema } from '#lib/validation/identity.js'
	import type { ProfileView } from '#lib/profile-contract.js'
	import FormFeedback from './FormFeedback.svelte'
	import { formReasonText } from '#lib/form-messages.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'
	import PhotoCropper from './photo-cropper/PhotoCropper.svelte'
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
	let pendingFile = $state<File | null>(null)
	let cropOpen = $state(false)
	let selectionError = $state(false)
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
		pendingFile = null
		cropOpen = false
		selectionError = false
	})
</script>

<Text id="avatar-help"
	>{m['images.formats']()} {m['images.max_file_size']()} {m['images.avatar_resize']()}</Text
>
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
			<input type="hidden" name="action" value="upload" />
			<InputAvatar
				label={m['nouns.avatar']({ count: 1 })}
				uploadLabel={m['actions.select_subject']({ subject: m['nouns.image']({ count: 1 }) })}
				bind:value={
					() => selectedFile,
					(file) => {
						if (file === null && selectedFile === savedFile && savedFile !== null) {
							onRemove()
							return
						}
						if (file) {
							if (!profileAvatarFormSchema.safeParse({ action: 'upload', file }).success) {
								selectedFile = savedFile
								pendingFile = null
								cropOpen = false
								selectionError = true
								onSelectionChange(savedFile)
								return
							}
							selectionError = false
							pendingFile = file
							cropOpen = true
							return
						}
						selectedFile = savedFile
						onSelectionChange(savedFile)
					}
				}
				infoLabel={m['labels.subject_details']({ subject: m['nouns.avatar']({ count: 1 }) })}
				closeLabel={m['actions.close']()}
				removeLabel={selectedFile === savedFile
					? m['actions.remove_subject']({ subject: m['nouns.avatar']({ count: 1 }) })
					: m['actions.clear_selected_subject']({ subject: m['nouns.image']({ count: 1 }) })}
				id="profile-avatar"
				name="file"
				accept={avatarMimeType.options.join(',')}
				aria-describedby="avatar-help"
				required
				disabled={!view.fieldsEditable}
			>
				{#snippet imageActions(file, closePreview)}
					<Button
						type="button"
						disabled={!view.fieldsEditable}
						onclick={() => {
							closePreview()
							pendingFile = file
							cropOpen = true
						}}>{m['actions.edit_subject']({ subject: m['nouns.avatar']({ count: 1 }) })}</Button
					>
				{/snippet}
			</InputAvatar>
			{#if selectionError}<p role="alert">{m['forms.validation_error']()}</p>{/if}
		{/snippet}
		{#snippet controls(view)}
			{#if selectedFile && selectedFile !== savedFile}
				<Button type="submit" disabled={!view.canSubmit}>
					{m['actions.save_subject']({ subject: m['nouns.avatar']({ count: 1 }) })}
				</Button>
			{/if}
		{/snippet}
		{#snippet feedback(view)}
			<FormFeedback
				{view}
				subject={m['nouns.profile']({ count: 1 })}
				reasonText={(reason) => formReasonText[reason]()}
				invalidMessage={m['forms.validation_error']()}
				successMessage={() =>
					m['status.saved_subject']({ subject: m['nouns.avatar']({ count: 1 }) })}
				section="result"
			/>
		{/snippet}
	</FormContent>
{/key}
{#if pendingFile}
	<Dialog
		heading={m['images.crop_avatar_title']()}
		bind:open={cropOpen}
		closedby="any"
		onclose={() => (pendingFile = null)}
	>
		<PhotoCropper
			file={pendingFile}
			mask="circle"
			oncomplete={(file) => {
				selectedFile = file
				onSelectionChange(file)
				pendingFile = null
				cropOpen = false
			}}
			oncancel={() => {
				pendingFile = null
				cropOpen = false
			}}
		/>
	</Dialog>
{/if}
