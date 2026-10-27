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
		sessionUnavailable: () => m['forms.session_unavailable'](),
		selectWorkspace: () =>
			m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) }),
		loadFailed: () =>
			m['errors.load_subject']({
				subject: m['labels.subject_settings']({ subject: m['nouns.workspace']({ count: 1 }) })
			}),
		loading: () =>
			m['status.loading_subject']({
				subject: m['labels.subject_settings']({ subject: m['nouns.workspace']({ count: 1 }) })
			}),
		workspaceUnavailable: () =>
			m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) }),
		readOnly: () => m['forms.read_only']()
	}
</script>

{#snippet formFeedback(section: 'readiness' | 'result')}
	<FormFeedback
		{view}
		{section}
		subject={section === 'readiness'
			? m['labels.subject_settings']({ subject: m['nouns.workspace']({ count: 1 }) })
			: m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) })}
		reasonText={(reason) => explanations[reason]()}
		invalidMessage={m['forms.enter_subject']({
			subject: m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) })
		})}
		successMessage={() =>
			m['status.saved_subject']({
				subject: m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) })
			})}
		{onRetryReadiness}
		blockedRole={(reason) => (reason === 'loadFailed' ? 'alert' : 'status')}
	/>
{/snippet}
{@render formFeedback('readiness')}

<FormContent {view} {onsubmit} {onreset} {oninput}>
	{#snippet fields(form)}
		<InputText
			label={m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) })}
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
