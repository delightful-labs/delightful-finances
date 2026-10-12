<script lang="ts">
	import { goto } from '$app/navigation'
	import { getJazzSession } from 'jazz-tools/svelte'
	import { RecoveryPhrase } from 'jazz-tools/passphrase'
	import { m } from '#lib/paraglide/messages.js'

	const session = getJazzSession()
	let restoring = $state(false)
	let restoreError = $state(false)

	async function restoreAccount(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		restoring = true
		restoreError = false
		try {
			const formData = new FormData(event.currentTarget)
			const phrase = String(formData.get('recoveryPhrase') ?? '')
			await session.restoreLocalFirst(RecoveryPhrase.toSecret(phrase))
			await goto('/')
		} catch {
			restoreError = true
		} finally {
			restoring = false
		}
	}
</script>

<svelte:head>
	<title>{m['login.heading']()} · {m['app.name']()}</title>
</svelte:head>

<h1>{m['login.heading']()}</h1>
<p>{m['login.description']()}</p>

<form onsubmit={restoreAccount}>
	<label for="recovery-phrase">{m['login.recovery_phrase']()}</label>
	<textarea id="recovery-phrase" name="recoveryPhrase" rows="4" required></textarea>
	{#if restoreError}
		<p role="alert">{m['login.restore_error']()}</p>
	{/if}
	<button type="submit" disabled={restoring}>
		{restoring ? m['login.restoring']() : m['login.restore_action']()}
	</button>
</form>
