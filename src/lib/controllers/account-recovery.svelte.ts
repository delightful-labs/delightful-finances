import { exportLocalFirstSecret } from 'jazz-tools'
import { getJazzSession } from 'jazz-tools/svelte'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import { get } from 'svelte/store'

export function createAccountRecoveryState() {
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
	return {
		revealPhrase,
		hidePhrase,
		confirmSaved(value: boolean) {
			savedConfirmed = value
		},
		get phrase() {
			return phrase
		},
		get revealed() {
			return revealed
		},
		get savedConfirmed() {
			return savedConfirmed
		},
		get loadError() {
			return loadError
		}
	}
}
