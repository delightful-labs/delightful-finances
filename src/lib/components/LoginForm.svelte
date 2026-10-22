<script lang="ts">
	import { Button, Textarea } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'

	let {
		restoring,
		restoreError,
		sessionError = false,
		onsubmit
	}: {
		restoring: boolean
		restoreError: boolean
		sessionError?: boolean
		onsubmit: (event: SubmitEvent) => Promise<void>
	} = $props()
</script>

<p>{m['login.description']()}</p>

<form {onsubmit}>
	<Textarea
		label={m['login.recovery_phrase']()}
		id="recovery-phrase"
		name="recoveryPhrase"
		rows={4}
		disabled={restoring}
		required
	></Textarea>
	{#if sessionError || restoreError}
		<p role="alert">{restoreError ? m['login.restore_error']() : m['login.session_error']()}</p>
	{/if}
	<Button type="submit" disabled={restoring}>
		{restoring ? m['login.restoring']() : m['navigation.login']()}
	</Button>
</form>
