<script lang="ts">
	import { Button, Textarea, Checkbox, Dialog } from 'delightful-ui'
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

<Button type="button" onclick={revealPhrase}>{m['recovery.show']()}</Button>

<Dialog
	heading={m['recovery.heading']()}
	aria-describedby="recovery-warning"
	bind:open={revealed}
	closedby="any"
	oncancel={hidePhrase}
	onclose={hidePhrase}
>
	{#if revealed}
		<div class="recovery-content">
			<p id="recovery-warning">{m['recovery.warning']()}</p>
			<Textarea
				label={m['recovery.phrase_label']()}
				id="account-recovery-phrase"
				rows={4}
				readonly
				value={phrase}
			></Textarea>
			<Checkbox label={m['recovery.confirm']()} bind:checked={savedConfirmed} />
			<div class="recovery-controls">
				<Button type="button" disabled={!savedConfirmed} onclick={hidePhrase}>
					{m['recovery.hide']()}
				</Button>
				<Button type="button" onclick={hidePhrase}>{m['recovery.close']()}</Button>
			</div>
		</div>
	{/if}
</Dialog>

{#if loadError}
	<p role="alert">{m['recovery.error']()}</p>
{/if}

<style>
	.recovery-content {
		display: grid;
		gap: var(--dui-space-sm, 1rem);
	}

	.recovery-content p {
		margin: 0;
	}

	.recovery-controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-space-xs, 0.5rem);
	}
</style>
