import { goto } from '$app/navigation'
import { getJazzSession } from 'jazz-tools/svelte'
import { RecoveryPhrase } from 'jazz-tools/passphrase'

export function createLoginState() {
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
	return {
		restoreAccount,
		get restoring() {
			return restoring
		},
		get restoreError() {
			return restoreError
		}
	}
}
