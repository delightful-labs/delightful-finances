<script lang="ts">
	import { exportLocalFirstSecret } from 'jazz-tools'
	import { getJazzSession } from 'jazz-tools/svelte'
	import { RecoveryPhrase } from 'jazz-tools/passphrase'
	import { m } from '#lib/paraglide/messages.js'

	const session = getJazzSession()
	let phrase = $state('')
	let revealed = $state(false)
	let savedConfirmed = $state(false)
	let loadError = $state(false)

	function revealPhrase() {
		const account = $session.account
		if (!account) {
			loadError = true
			return
		}

		try {
			phrase = RecoveryPhrase.fromSecret(exportLocalFirstSecret(account))
			revealed = true
			loadError = false
		} catch {
			loadError = true
		}
	}

	function hidePhrase() {
		phrase = ''
		revealed = false
		savedConfirmed = false
	}
</script>

<svelte:head>
	<title>{m['recovery.heading']()} · {m['app.name']()}</title>
</svelte:head>

<h1>{m['recovery.heading']()}</h1>
<p>{m['recovery.description']()}</p>

{#if !revealed}
	<button type="button" onclick={revealPhrase}>{m['recovery.show']()}</button>
{:else}
	<p role="alert">{m['recovery.warning']()}</p>
	<label for="account-recovery-phrase">{m['recovery.phrase_label']()}</label>
	<textarea id="account-recovery-phrase" rows="4" readonly value={phrase}></textarea>
	<label>
		<input type="checkbox" bind:checked={savedConfirmed} />
		{m['recovery.confirm']()}
	</label>
	<button type="button" disabled={!savedConfirmed} onclick={hidePhrase}>
		{m['recovery.hide']()}
	</button>
{/if}

{#if loadError}
	<p role="alert">{m['recovery.error']()}</p>
{/if}
