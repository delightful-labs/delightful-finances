<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import InternalTransferEntry from '#lib/components/InternalTransferEntry.svelte'
</script>

<svelte:head><title>{m['nouns.transfer']({ count: 1 })} · {m['app.name']()}</title></svelte:head>
<PageHeader title={m['actions.add_subject']({ subject: m['nouns.transfer']({ count: 1 }) })} />
<InternalTransferEntry />
