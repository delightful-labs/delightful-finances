<script lang="ts">
	import { get } from 'svelte/store'
	import { RecoveryPhrase } from 'jazz-tools/passphrase'
	import { getJazzSession } from 'jazz-tools/svelte'
	import { exportLocalFirstSecret } from 'jazz-tools'
	import { m } from '#lib/paraglide/messages.js'
	import AccountRecovery from '#lib/components/AccountRecovery.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'

	const session = getJazzSession()
	let phrase = $state('')
	let revealed = $state(false)
	let savedConfirmed = $state(false)
	let loadError = $state(false)

	function revealPhrase() {
		const account = get(session).account
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
	function confirmSaved(value: boolean) {
		savedConfirmed = value
	}
</script>

<svelte:head><title>{m['recovery.heading']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['recovery.heading']()} />
<AccountRecovery
	{phrase}
	{revealed}
	{savedConfirmed}
	{loadError}
	onReveal={revealPhrase}
	onHide={hidePhrase}
	onConfirm={confirmSaved}
/>
