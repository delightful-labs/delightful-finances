<script lang="ts">
	import { onDestroy } from 'svelte'
	import { getBankSync } from '#lib/runtime/bank-sync.js'
	import { m } from '#lib/paraglide/messages.js'

	const bankSync = getBankSync()
	onDestroy(() => bankSync.cancel())
</script>

<svelte:head><title>{m['bank.title']()} · {m['app.name']()}</title></svelte:head>
{@render bankSync.view()}
