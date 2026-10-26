<script lang="ts">
	import { Button, Dialog, StatusMessage } from 'delightful-ui'
	import type {
		InternalTransferDeleteChoice,
		InternalTransferDeleteResult
	} from '#lib/machines/internal-transfer.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		transactionId,
		available,
		pending,
		result,
		onDelete
	}: {
		transactionId: string
		available: boolean
		pending: boolean
		result: InternalTransferDeleteResult | null
		onDelete: (choice: InternalTransferDeleteChoice) => void
	} = $props()
	let open = $state(false)
	const feedbackText = $derived(
		result?.outcome === 'succeeded'
			? result.choice.kind === 'both'
				? m['transfers.delete_saved_both']()
				: m['transfers.delete_saved_selected']()
			: result?.outcome === 'recoveryRequired'
				? m['transfers.delete_recovery_required']()
				: result?.outcome === 'denied'
					? m['transfers.delete_denied']()
					: result && result.outcome !== 'cancelled' && result.outcome !== 'closed'
						? m['transfers.delete_unavailable']()
						: undefined
	)
	const feedbackVariant = $derived(
		result?.outcome === 'succeeded' && result.settlement === 'locallyPersisted'
			? 'success'
			: 'error'
	)
	function choose(choice: InternalTransferDeleteChoice) {
		open = false
		onDelete(choice)
	}
</script>

{#if available}
	<Button type="button" disabled={pending} onclick={() => (open = true)}>
		{m['actions.delete_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
	</Button>
{/if}

{#if pending}
	<StatusMessage variant="loading" text={m['transfers.delete_pending']()} />
{:else if feedbackText}
	<StatusMessage variant={feedbackVariant} text={feedbackText} />
{/if}

<Dialog heading={m['transfers.delete_heading']()} bind:open closedby="any">
	<p>{m['transfers.delete_effect_both']()}</p>
	<Button type="button" onclick={() => choose({ kind: 'both' })}>
		{m['transfers.delete_both']()}
	</Button>
	<p>{m['transfers.delete_effect_selected']()}</p>
	<Button type="button" onclick={() => choose({ kind: 'selected', transactionId })}>
		{m['transfers.delete_selected']()}
	</Button>
	<Button type="button" onclick={() => (open = false)}>{m['actions.cancel']()}</Button>
</Dialog>
