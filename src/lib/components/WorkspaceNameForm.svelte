<script lang="ts">
	import { Button, InputText } from 'delightful-ui'
	import type {
		WorkspaceRenameReason,
		WorkspaceRenameView
	} from '#lib/workspace-rename-contract.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'
	import FormFeedback from './FormFeedback.svelte'

	let {
		name,
		view,
		onsubmit,
		onreset,
		oninput,
		onRetryReadiness
	}: {
		name: string
		view: WorkspaceRenameView
		onsubmit: (event: SubmitEvent) => void
		oninput: (event: Event) => void
		onreset: (event: Event) => void
		onRetryReadiness: () => void
	} = $props()
	const explanations: Record<WorkspaceRenameReason, () => string> = {
		sessionUnavailable: () => m['workspace.rename_session_unavailable'](),
		selectWorkspace: () => m['workspace.select_workspace'](),
		loadFailed: () => m['errors.load']({ subject: m['labels.workspace_settings']() }),
		loading: () => m['status.loading']({ subject: m['labels.workspace_settings']() }),
		workspaceUnavailable: () => m['workspace.rename_unavailable'](),
		readOnly: () => m['workspace.rename_restricted']()
	}
</script>

{#snippet formFeedback(section: 'readiness' | 'result')}
	<FormFeedback
		{view}
		{section}
		subject={section === 'readiness'
			? m['labels.workspace_settings']()
			: m['labels.workspace_name']()}
		reasonText={(reason) => explanations[reason]()}
		invalidMessage={m['workspace.name_required']()}
		successMessage={() => m['actions.saved']({ subject: m['labels.workspace_name']() })}
		{onRetryReadiness}
		blockedRole={(reason) => (reason === 'loadFailed' ? 'alert' : 'status')}
		messages={{
			sessionUnavailable: explanations.sessionUnavailable(),
			settling: m['workspace.rename_settling'](),
			scopeChanged: m['workspace.rename_scope_changed'](),
			cancelled: m['workspace.rename_cancelled'](),
			closed: m['workspace.rename_closed'](),
			interruptedSaved: m['workspace.rename_interrupted_saved'](),
			unknown: m['workspace.rename_unknown']()
		}}
	/>
{/snippet}
{@render formFeedback('readiness')}

<FormContent {view} {onsubmit} {onreset} {oninput}>
	{#snippet fields(form)}
		<InputText
			label={m['labels.workspace_name']()}
			id="workspace-name"
			name="name"
			value={name}
			required
			disabled={!form.fieldsEditable}
		/>
	{/snippet}
	{#snippet controls(form)}
		<Button type="submit" disabled={!form.canSubmit}>
			{m['actions.save']()}
		</Button>
	{/snippet}
	{#snippet feedback()}
		{@render formFeedback('result')}
	{/snippet}
</FormContent>
