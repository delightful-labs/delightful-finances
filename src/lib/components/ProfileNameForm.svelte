<script lang="ts">
	import { Button, InputText } from 'delightful-ui'
	import type { z } from 'zod'
	import type { profileNameFormSchema } from '#lib/validation/identity.js'
	import type { FormController } from '#lib/forms.svelte.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'
	let {
		profileId,
		displayName,
		form
	}: {
		profileId: string
		displayName: string | null | undefined
		form: FormController<
			z.output<typeof profileNameFormSchema>,
			void,
			{ profileId: string | null; userId: string | null }
		>
	} = $props()
</script>

<h2>{m['labels.profile']()}</h2>
<p>{m['profile.name_description']()}</p>
{#key profileId}
	<FormContent view={form.view} onsubmit={form.submit} onreset={form.reset}>
		{#snippet fields(view)}
			<InputText
				label={m['labels.display_name']()}
				id="profile-display-name"
				name="displayName"
				value={displayName ?? ''}
				disabled={view.disabled}
				autocomplete="nickname"
			/>
		{/snippet}
		{#snippet controls(view)}
			<Button type="submit" disabled={view.disabled}
				>{view.busy
					? m['status.saving']({ subject: m['labels.profile']() })
					: m['actions.save']()}</Button
			>
		{/snippet}
		{#snippet feedback(view)}
			{#if view.state.matches('success')}
				<p role="status">{m['profile.name_saved']()}</p>
			{:else if view.state.matches('invalid')}
				<p role="alert">{m['profile.name_invalid']()}</p>
			{:else if view.state.matches('error')}
				<p role="alert">{m['errors.save']({ subject: m['labels.profile']() })}</p>
			{/if}
		{/snippet}
	</FormContent>
{/key}
