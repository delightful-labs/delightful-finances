<script lang="ts">
	import { Button, Heading, Text, InputAvatar, StatusMessage } from 'delightful-ui'
	import type { z } from 'zod'
	import { avatarMimeType, type profileAvatarFormSchema } from '#lib/validation/identity.js'
	import type { FormController } from '#lib/forms.svelte.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'
	let {
		profileId,
		avatarData,
		mimeType,
		form,
		onRemove
	}: {
		profileId: string
		avatarData: Uint8Array | null | undefined
		mimeType: string | null | undefined
		form: FormController<
			z.output<typeof profileAvatarFormSchema>,
			void,
			{ profileId: string | null; userId: string | null }
		>
		onRemove: () => void
	} = $props()
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

<Heading level="h3">{m['labels.avatar']()}</Heading>
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
{#key profileId}
	<FormContent view={form.view} onsubmit={form.submit} onreset={form.reset}>
		{#snippet fields(view)}
			<input type="hidden" name="action" value="upload" />
			<InputAvatar
				label={m['labels.avatar']()}
				uploadLabel={m['actions.upload_avatar']()}
				removeLabel={m['actions.clear_selected_image']()}
				id="profile-avatar"
				name="file"
				accept={avatarMimeType.options.join(',')}
				aria-describedby="avatar-help"
				required
				disabled={view.disabled}
			/>
		{/snippet}
		{#snippet controls(view)}
			<Button type="submit" disabled={view.disabled}
				>{view.busy
					? m['status.saving']({ subject: m['labels.avatar']() })
					: avatarData
						? m['actions.replace_avatar']()
						: m['actions.upload_avatar']()}</Button
			>
			{#if avatarData}
				<Button type="button" disabled={view.disabled} onclick={onRemove}
					>{m['actions.remove_avatar']()}</Button
				>
			{/if}
		{/snippet}
		{#snippet feedback(view)}
			{#if view.state.matches('success')}
				<StatusMessage variant="success" text={m['profile.avatar_saved']()} />
			{:else if view.state.matches('invalid')}
				<StatusMessage variant="error" text={m['profile.avatar_invalid']()} />
			{:else if view.state.matches('error')}
				<StatusMessage variant="error" text={m['errors.save']({ subject: m['labels.avatar']() })} />
			{/if}
		{/snippet}
	</FormContent>
{/key}
