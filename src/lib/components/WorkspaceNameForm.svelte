<script lang="ts">
	import { getDb } from 'jazz-tools/svelte'
	import { z } from 'zod'
	import Form from './Form.svelte'
	import type { Organization } from '#lib/schema.js'
	import { renameWorkspace } from '#lib/data.js'
	import { m } from '#lib/paraglide/messages.js'
	import type { FormSave } from '#lib/machines/form.js'

	let { workspace, canRename }: { workspace: Organization; canRename: boolean } = $props()
	const db = getDb()
	const schema = z.object({ name: z.string().trim().min(1) })
	const save: FormSave<z.output<typeof schema>, void, Pick<Organization, 'id'>> = async (
		values,
		{ context, signal }
	) => {
		if (!canRename) throw new Error('The workspace is not editable.')
		signal.throwIfAborted()
		await renameWorkspace(db, context.id, values.name)
	}
</script>

{#key workspace.id}
	<Form {schema} {save} context={{ id: workspace.id }} disabled={!canRename}>
		{#snippet fields(form)}
			<label for="workspace-name">{m['labels.workspace_name']()}</label>
			<input
				id="workspace-name"
				name="name"
				value={workspace.name}
				required
				readonly={!canRename}
				disabled={form.busy}
			/>
		{/snippet}
		{#snippet controls(form)}
			<button type="submit" disabled={form.disabled}>
				{form.busy ? m['status.saving']({ subject: m['workspace.label']() }) : m['actions.save']()}
			</button>
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
	</Form>
{/key}

{#if !canRename}
	<p>{m['workspace.rename_restricted']()}</p>
{/if}
