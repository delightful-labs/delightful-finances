<script lang="ts">
	import AppLink from '#lib/components/navigation/AppLink.svelte'
	import { Button, InputText, ScreenReaderText } from 'delightful-ui'
	import {
		workspaceCreationFormView,
		type WorkspaceCreationView
	} from '#lib/machines/workspace-creation.js'
	import FormModal from './FormModal.svelte'
	import { m } from '#lib/paraglide/messages.js'
	let {
		scope,
		view,
		onSubmit,
		onRetry,
		onNew
	}: {
		scope: unknown
		view: WorkspaceCreationView
		onSubmit: (name: string) => void
		onRetry: () => void
		onNew: () => void
	} = $props()
	const formView = $derived(workspaceCreationFormView(view))
	let name = $state('')
	$effect(() => {
		if (view.mode === 'editing') name = ''
	})
	const descriptions = {
		unavailable: () => m['workspace.create_unavailable'](),
		working: () => m['workspace.create_working'](),
		editing: () => '',
		invalid: () =>
			m['forms.enter_subject']({
				subject: m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) })
			}),
		recovered: () => m['workspace.create_recovered'](),
		complete: () => m['status.saved_subject']({ subject: m['nouns.workspace']({ count: 1 }) }),
		conflict: () => m['workspace.create_conflict'](),
		failed: () => m['workspace.create_failed'](),
		unresolved: () => m['workspace.create_unresolved']()
	}
	const message = $derived(descriptions[view.mode]())
	const urgent = $derived(['invalid', 'conflict', 'failed', 'unresolved'].includes(view.mode))
</script>

<FormModal
	{scope}
	label={m['actions.create_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}
	view={formView}
	onopen={() => {
		if (view.canCreateAnother) onNew()
	}}
	onsubmit={(event) => {
		event.preventDefault()
		onSubmit(name)
	}}
	onreset={(event) => event.preventDefault()}
>
	{#snippet fields(form)}
		<InputText
			id="create-workspace-name"
			label={m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) })}
			name="name"
			bind:value={name}
			required
			disabled={!form.fieldsEditable}
		/>
	{/snippet}
	{#snippet announcements()}
		<ScreenReaderText role="status">{urgent ? '' : message}</ScreenReaderText>
		<ScreenReaderText role="alert">{urgent ? message : ''}</ScreenReaderText>
	{/snippet}
	{#snippet feedback()}
		{#if message && view.mode !== 'working'}<p aria-hidden="true">{message}</p>{/if}
		{#if view.name && view.mode !== 'complete'}<p>{view.name}</p>{/if}
		{#if view.canRetry}<Button type="button" onclick={onRetry}>{m['actions.retry']()}</Button>{/if}
		{#if view.canCreateAnother}
			{#if view.workspace}<p>
					<AppLink href="/" query={{ workspace: view.workspace.id }}
						>{m['actions.open_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}: {view
							.workspace.name}</AppLink
					>
				</p>{/if}
			<Button type="button" onclick={onNew}
				>{m['actions.create_another_subject']({
					subject: m['nouns.workspace']({ count: 1 })
				})}</Button
			>
		{/if}
	{/snippet}
</FormModal>
