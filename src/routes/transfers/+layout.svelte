<script lang="ts">
	import type { Snippet } from 'svelte'
	import TransferView from '#lib/components/transfers/TransferView.svelte'
	let { children }: { children: Snippet } = $props()
</script>

<TransferView {children} />
