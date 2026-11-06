<script lang="ts">
	import { Button, Heading, InputText, Select } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	import type {
		selectWorkspaceBackup,
		BackupMessage
	} from '#lib/machines/workspaces/workspace-backup.js'
	let {
		view,
		ondownload,
		oncancel
	}: {
		view: ReturnType<typeof selectWorkspaceBackup>
		ondownload: (protection: 'none' | 'password', password: string) => void
		oncancel: () => void
	} = $props()
	let protection = $state('password'),
		password = $state('')
	const messages: Record<Exclude<BackupMessage, undefined>, () => string> = {
		preparing: () => m['status.preparing_subject']({ subject: m['nouns.backup']({ count: 1 }) }),
		downloaded: () => m['status.download_started'](),
		cancelled: () => m['status.cancelled'](),
		permissionDenied: () => m['errors.permission_denied'](),
		dataChanged: () => m['errors.data_changed'](),
		failed: () => m['errors.operation_failed'](),
		password: () => m['forms.enter_subject']({ subject: m['labels.password']() })
	}
	$effect(() => {
		if (!view.editable) password = ''
	})
	function submit(event: SubmitEvent) {
		event.preventDefault()
		ondownload(protection === 'none' ? 'none' : 'password', password)
		password = ''
	}
</script>

<Heading level="h2">{m['nouns.backup']({ count: 1 })}</Heading>
<form onsubmit={submit}>
	<Select
		id="workspace-backup-protection"
		label={m['nouns.backup']({ count: 1 })}
		bind:value={protection}
		disabled={!view.editable}
	>
		<option value="password">{m['labels.with_password']()}</option>
		<option value="none">{m['labels.without_password']()}</option>
	</Select>
	{#if protection === 'password'}
		<InputText
			id="workspace-backup-password"
			type="password"
			label={m['labels.password']()}
			bind:value={password}
			autocomplete="new-password"
			disabled={!view.editable}
		/>
	{/if}
	<Button type="submit" disabled={!view.canDownload}
		>{m['actions.download_subject']({ subject: m['nouns.backup']({ count: 1 }) })}</Button
	>
	{#if view.canCancel}<Button type="button" onclick={oncancel}>{m['actions.cancel']()}</Button>{/if}
	{#if view.message}<p role={view.alert ? 'alert' : 'status'}>{messages[view.message]()}</p>{/if}
</form>
