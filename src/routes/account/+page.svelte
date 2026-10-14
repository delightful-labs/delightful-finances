<script lang="ts">
	import { createAccountRecoveryState } from '#lib/controllers/account-recovery.svelte.js'
	import { m } from '#lib/paraglide/messages.js'
	import AccountRecovery from '#lib/components/AccountRecovery.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'

	const recovery = createAccountRecoveryState()
</script>

<svelte:head><title>{m['recovery.heading']()} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['recovery.heading']()} />
<AccountRecovery
	phrase={recovery.phrase}
	revealed={recovery.revealed}
	savedConfirmed={recovery.savedConfirmed}
	loadError={recovery.loadError}
	onReveal={recovery.revealPhrase}
	onHide={recovery.hidePhrase}
	onConfirm={recovery.confirmSaved}
/>
