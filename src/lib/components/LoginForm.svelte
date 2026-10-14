<script lang="ts">
	import { Button, Textarea } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'

	let {
		restoring,
		restoreError,
		onsubmit
	}: {
		restoring: boolean
		restoreError: boolean
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
		required
	></Textarea>
	{#if restoreError}
		<p role="alert">{m['login.restore_error']()}</p>
	{/if}
	<Button type="submit" disabled={restoring}>
		{restoring ? m['login.restoring']() : m['login.restore_action']()}
	</Button>
</form>
