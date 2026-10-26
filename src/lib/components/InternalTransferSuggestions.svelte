<script lang="ts">
	import { Button } from 'delightful-ui'
	import AppLink from '#lib/components/AppLink.svelte'
	import { formatMoney } from '#lib/domain/money.js'
	import type {
		InternalTransferCandidate
	} from '#lib/domain/internal-transfer.js'
	import type { TransactionRow } from '#lib/schema.js'
	import type {
		InternalTransferLinkResult,
		InternalTransferUnlinkResult
	} from '#lib/machines/internal-transfer.js'
	import type { TransactionEditTransferState } from '#lib/machines/transaction-edit.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'

	type Suggestion = InternalTransferCandidate & {
		accountName: string | undefined
		description: TransactionRow['description'] | undefined
	}
	let {
		suggestions,
		writableSuggestionIds,
		editorState,
		selectedId,
		onSelect,
		pending,
		result,
		onLink,
		unlinkAvailable,
		unlinkWritable,
		unlinkPending,
		unlinkResult,
		linkedCounterpartHref,
		onUnlink
	}: {
		suggestions: readonly Suggestion[]
		writableSuggestionIds: ReadonlySet<string>
		editorState: Exclude<TransactionEditTransferState, 'unselected'>
		selectedId: string | null
		onSelect: ((transactionId: string) => void) | undefined
		pending: boolean
		result: InternalTransferLinkResult | null
		onLink: (transactionId: string) => void
		unlinkAvailable: boolean
		unlinkWritable: boolean
		unlinkPending: boolean
		unlinkResult: InternalTransferUnlinkResult | null
		linkedCounterpartHref: string | null
		onUnlink: (() => void) | undefined
	} = $props()

	const selectedSuggestionIsWritable = $derived(
		selectedId !== null && writableSuggestionIds.has(selectedId)
	)
	const dates = $derived(
		new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeZone: 'UTC' })
	)
	function formatDate(value: string) {
		return dates.format(new Date(`${value}T00:00:00.000Z`))
	}
	const resultMessage = $derived.by(() => {
		if (!result) return ''
		if (result.outcome === 'succeeded')
			return m['status.saved_subject']({ subject: m['nouns.transfer']({ count: 1 }) })
		if (result.outcome === 'cancelled') return m['forms.cancelled']()
		if (result.outcome === 'closed') return m['forms.closed']()
		return m['transfers.operation_failed']()
	})
	const unlinkResultMessage = $derived.by(() => {
		if (!unlinkResult) return ''
		if (unlinkResult.outcome === 'succeeded') return m['transfers.unlink_saved']()
		if (unlinkResult.outcome === 'recoveryRequired') return m['transfers.recovery_required']()
		if (unlinkResult.outcome === 'cancelled') return m['forms.cancelled']()
		if (unlinkResult.outcome === 'closed') return m['forms.closed']()
		return m['transfers.operation_failed']()
	})
	const statusMessage = $derived.by(() => {
		if (editorState === 'searching') return m['transfers.searching']()
		if (editorState === 'failed') return m['transfers.search_failed']()
		if (unlinkPending) return m['transfers.unlink_pending']()
		if (unlinkResultMessage) return unlinkResultMessage
		if (pending) return m['transfers.link_pending']()
		return resultMessage
	})
</script>

<section aria-labelledby="transfer-suggestions-heading">
	<h2 id="transfer-suggestions-heading">{m['transfers.suggestions_heading']()}</h2>
	{#if editorState === 'linked'}
		<p>{m['transfers.linked_status']()}</p>
		{#if linkedCounterpartHref}
			<AppLink href={linkedCounterpartHref}
				>{m['actions.open_subject']({ subject: m['nouns.transaction']({ count: 1 }) })}</AppLink
			>
		{/if}
		{#if unlinkAvailable && onUnlink}
			<Button type="button" disabled={!unlinkWritable || unlinkPending} onclick={onUnlink}>
				{m['actions.unlink_subject']({ subject: m['nouns.transfer']({ count: 1 }) })}
			</Button>
		{/if}
		{#if unlinkAvailable && !unlinkWritable}<p>
				{m['transfers.permission_required']()}
			</p>{/if}
		{#if !unlinkAvailable && !unlinkPending}<p>{m['transfers.operation_failed']()}</p>{/if}
	{/if}
	{#if editorState === 'conflicted'}
		<p>{m['transfers.conflict_notice']()}</p>
	{/if}
	{#if editorState === 'empty'}
		<p>{m['transfers.no_matches']()}</p>
	{/if}
	{#if editorState === 'matches'}
		<fieldset>
			<legend>{m['transfers.select_match']()}</legend>
			{#each suggestions as suggestion (suggestion.id)}
				<label>
					<input
						type="radio"
						name="transfer-counterpart"
						value={suggestion.id}
						checked={selectedId === suggestion.id}
						onchange={() => onSelect?.(suggestion.id)}
					/>
					<span>
						{formatDate(suggestion.bookedOn)} · {suggestion.accountName ??
							m['status.unavailable_subject']({ subject: m['nouns.account']({ count: 1 }) })}
						{#if suggestion.description}
							· {suggestion.description}{/if}
					</span>
					<span>{formatMoney(suggestion.amountMinor, suggestion.currency, getLocale())}</span>
				</label>
			{/each}
		</fieldset>
		<Button
			type="button"
			disabled={!selectedId || !selectedSuggestionIsWritable || pending}
			onclick={() => {
				if (selectedId) onLink(selectedId)
			}}
		>
			{m['actions.link_existing_subject']({ subject: m['nouns.transaction']({ count: 1 }) })}
		</Button>
		{#if !selectedSuggestionIsWritable}
			<p>{m['transfers.permission_required']()}</p>
		{/if}
	{/if}
	<p>{statusMessage}</p>
</section>
