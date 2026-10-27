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
				? m['transfers.recovery_required']()
				: result && result.outcome !== 'cancelled' && result.outcome !== 'closed'
					? m['errors.save_subject']({ subject: m['nouns.transaction']({ count: 2 }) })
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
	<StatusMessage variant="loading" text={m['forms.settling']()} />
{:else if feedbackText}
	<StatusMessage variant={feedbackVariant} text={feedbackText} />
{/if}

<Dialog
	heading={m['actions.delete_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
	bind:open
	closedby="any"
>
	<p>{m['transfers.delete_effect_both']()}</p>
	<Button type="button" onclick={() => choose({ kind: 'both' })}>
		{m['actions.delete_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
	</Button>
	<p>{m['transfers.delete_effect_selected']()}</p>
	<Button type="button" onclick={() => choose({ kind: 'selected', transactionId })}>
		{m['actions.delete_subject']({ subject: m['nouns.transaction']({ count: 1 }) })}
	</Button>
	<Button type="button" onclick={() => (open = false)}>{m['actions.cancel']()}</Button>
</Dialog>
