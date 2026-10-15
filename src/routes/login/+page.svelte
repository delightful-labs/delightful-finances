<script lang="ts">
	import { RecoveryPhrase } from 'jazz-tools/passphrase'
	import { getJazzSession } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { goto } from '$app/navigation'
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import LoginForm from '#lib/components/LoginForm.svelte'

	const session = getJazzSession()
	const snapshot = fromStore(session)
	let restoreSessionError = $state(false)
	const sessionError = $derived(restoreSessionError || Boolean(snapshot.current.error))
	let restoring = $state(false)
	let restoreError = $state(false)

	async function restoreAccount(event: SubmitEvent) {
		event.preventDefault()
		if (restoring) return
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		restoreError = false
		restoreSessionError = false
		let secret: ReturnType<typeof RecoveryPhrase.toSecret>
		try {
			const formData = new FormData(event.currentTarget)
			secret = RecoveryPhrase.toSecret(String(formData.get('recoveryPhrase') ?? ''))
		} catch {
			restoreError = true
			return
		}
		restoring = true
		try {
			await session.restoreLocalFirst(secret)
			await goto('/')
		} catch {
			restoreSessionError = true
		} finally {
			restoring = false
		}
	}
</script>

<svelte:head><title>{m['login.heading']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['login.heading']()} />
<LoginForm {restoring} {restoreError} {sessionError} onsubmit={restoreAccount} />
