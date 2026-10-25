<script lang="ts">
	import { Button } from 'delightful-ui'
	import { formatMoney } from '#lib/domain/money.js'
	import type { InternalTransferCandidate } from '#lib/domain/internal-transfer.js'
	import type { TransactionRow } from '#lib/schema.js'
	import type { InternalTransferLinkResult } from '#lib/machines/internal-transfer.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'

	type Suggestion = InternalTransferCandidate & {
		accountName: string | undefined
		description: TransactionRow['description'] | undefined
	}
	let {
		suggestions,
		writableSuggestionIds,
		loading,
		failed,
		pending,
		result,
		onLink
	}: {
		suggestions: readonly Suggestion[]
		writableSuggestionIds: ReadonlySet<string>
		loading: boolean
		failed: boolean
		pending: boolean
		result: InternalTransferLinkResult | null
		onLink: (transactionId: string) => void
	} = $props()

	let selectedId = $state('')
	$effect(() => {
		if (!suggestions.some(({ id }) => id === selectedId)) selectedId = suggestions[0]?.id ?? ''
	})
	const selectedSuggestionIsWritable = $derived(writableSuggestionIds.has(selectedId))
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
		if (result.outcome === 'denied') return m['transfers.link_denied']()
		if (result.outcome === 'incompatible') return m['transfers.link_incompatible']()
		if (result.outcome === 'alreadyLinked') return m['transfers.link_already_linked']()
		return m['transfers.link_unavailable']()
	})
</script>

<section aria-labelledby="transfer-suggestions-heading">
	<h2 id="transfer-suggestions-heading">{m['transfers.suggestions_heading']()}</h2>
	{#if loading}
		<p role="status">{m['transfers.searching']()}</p>
	{:else if failed}
		<p role="status">{m['transfers.search_failed']()}</p>
	{:else if suggestions.length === 0}
		<p>{m['transfers.no_matches']()}</p>
	{:else}
		<fieldset>
			<legend>{m['transfers.select_match']()}</legend>
			{#each suggestions as suggestion (suggestion.id)}
				<label>
					<input
						type="radio"
						name="transfer-counterpart"
						value={suggestion.id}
						bind:group={selectedId}
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
			onclick={() => onLink(selectedId)}
		>
			{m['actions.link_existing_subject']({ subject: m['nouns.transaction']({ count: 1 }) })}
		</Button>
		{#if !selectedSuggestionIsWritable}
			<p>{m['transfers.link_permission_required']()}</p>
		{/if}
	{/if}
	{#if pending}<p role="status">{m['transfers.link_pending']()}</p>{/if}
	{#if resultMessage}<p role="status">{resultMessage}</p>{/if}
</section>
