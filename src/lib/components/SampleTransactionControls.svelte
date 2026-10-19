<script lang="ts">
	import { Button, Text } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	let {
		kind,
		busy,
		saved,
		failed,
		onadd
	}: {
		kind: 'income' | 'expense'
		busy: boolean
		saved: number
		failed: boolean
		onadd: () => void
	} = $props()
</script>

<div>
	<Button type="button" disabled={busy} onclick={onadd}
		>{kind === 'income'
			? m['transactions.samples.add_income']()
			: m['transactions.samples.add_expenses']()}</Button
	>
	<Text>{m['transactions.samples.description']()}</Text>
	{#if busy || saved > 0 || failed}
		<Text role="status"
			>{failed
				? m['transactions.samples.failed']({ count: saved })
				: m['transactions.samples.saved']({ count: saved })}</Text
		>
	{/if}
</div>
