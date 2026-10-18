<script lang="ts">
	import { Button, InputText } from 'delightful-ui'
	import type {
		WorkspaceRenameReason,
		WorkspaceRenameView
	} from '#lib/workspace-rename-contract.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'

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

{#if view.readiness.kind === 'observing'}
	<p role="status">{explanations.loading()}</p>
{:else if view.readiness.kind === 'blocked'}
	<p role={view.readiness.reason === 'loadFailed' ? 'alert' : 'status'}>
		{explanations[view.readiness.reason]()}
	</p>
{:else if view.readiness.kind === 'failed'}
	<p role="alert">{m['errors.load']({ subject: m['labels.workspace_settings']() })}</p>
{:else if view.readiness.kind === 'closed'}
	<p role="status">{explanations.sessionUnavailable()}</p>
{/if}
{#if view.canRetryReadiness}
	<Button type="button" onclick={onRetryReadiness}>{m['actions.retry']()}</Button>
{/if}
{#if view.activity.kind === 'settling'}
	<p role="status">{m['workspace.rename_settling']()}</p>
{/if}

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
	{#snippet feedback(form)}
		{#if form.feedback.kind === 'result'}
			{@const result = form.feedback.result}
			{#if result.outcome === 'succeeded'}
				<p role="status">{m['workspace.name_saved']()}</p>
			{:else if result.outcome === 'invalid'}
				<p role="alert">{m['workspace.name_required']()}</p>
			{:else if result.outcome === 'denied' || result.outcome === 'unavailable'}
				<p role="alert">{explanations[result.reason]()}</p>
			{:else if result.outcome === 'scopeChanged' || result.outcome === 'cancelled' || result.outcome === 'closed'}
				<p role="status">
					{result.outcome === 'scopeChanged'
						? m['workspace.rename_scope_changed']()
						: result.outcome === 'cancelled'
							? m['workspace.rename_cancelled']()
							: m['workspace.rename_closed']()}
				</p>
				{#if result.settlement === 'locallyPersisted'}
					<p role="status">{m['workspace.rename_interrupted_saved']()}</p>
				{:else if result.settlement === 'unknown'}
					<p role="alert">{m['workspace.rename_unknown']()}</p>
				{/if}
			{:else}
				<p role="alert">{m['errors.save']({ subject: m['labels.workspace_name']() })}</p>
				{#if result.settlement === 'unknown'}
					<p role="alert">{m['workspace.rename_unknown']()}</p>
				{/if}
			{/if}
		{/if}
	{/snippet}
</FormContent>
