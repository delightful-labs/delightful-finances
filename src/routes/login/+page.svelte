<script lang="ts">
	import { RecoveryPhrase } from 'jazz-tools/passphrase'
	import { getJazzSession } from 'jazz-tools/svelte'
	import { goto } from '$app/navigation'
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import LoginForm from '#lib/components/LoginForm.svelte'

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

<svelte:head><title>{m['login.heading']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['login.heading']()} />
<LoginForm {restoring} {restoreError} onsubmit={restoreAccount} />
