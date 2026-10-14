<script lang="ts">
	import { Button, InputText } from 'delightful-ui'
	import type { z } from 'zod'
	import type { Organization } from '#lib/schema.js'
	import type { FormController } from '#lib/controllers/form.svelte.js'
	import type { workspaceNameFormSchema } from '#lib/validation/identity.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'

	let {
		workspace,
		canRename,
		form
	}: {
		workspace: Organization
		canRename: boolean
		form: FormController<z.output<typeof workspaceNameFormSchema>, void, Pick<Organization, 'id'>>
	} = $props()
</script>

{#key workspace.id}
	<FormContent view={form.view} onsubmit={form.submit} onreset={form.reset}>
		{#snippet fields(form)}
			<InputText
				label={m['labels.workspace_name']()}
				id="workspace-name"
				name="name"
				value={workspace.name}
				required
				readonly={!canRename}
				disabled={form.busy}
			/>
		{/snippet}
		{#snippet controls(form)}
			<Button type="submit" disabled={form.disabled}>
				{form.busy ? m['status.saving']({ subject: m['workspace.label']() }) : m['actions.save']()}
			</Button>
		{/snippet}
		{#snippet feedback(form)}
			{#if form.state.matches('success')}
				<p role="status">{m['workspace.name_saved']()}</p>
			{:else if form.state.matches('invalid')}
				<p role="alert">{m['workspace.name_required']()}</p>
			{:else if form.state.matches('error')}
				<p role="alert">{m['errors.save']({ subject: m['labels.workspace_name']() })}</p>
			{/if}
		{/snippet}
	</FormContent>
{/key}

{#if !canRename}
	<p>{m['workspace.rename_restricted']()}</p>
{/if}
