<script lang="ts">
	import { Pagination } from 'delightful-ui'
	import type { PublicLedgerView } from '#lib/runtime/worker/ledger-protocol.js'
	import { m } from '#lib/paraglide/messages.js'
	import PaginationLink from '../navigation/PaginationLink.svelte'
	let { view }: { view: PublicLedgerView } = $props()
</script>

{#if view.pageCount > 1}
	<Pagination label={m['transactions.pagination.label']()}>
		<PaginationLink
			label={m['labels.previous_subject']({ subject: m['nouns.page']({ count: 1 }) })}
			href={view.previousHref ?? undefined}
			disabled={view.previousHref === null}>‹</PaginationLink
		>
		{#each view.slots as slot, index (slot.page)}
			{#if index > 0 && slot.page - (view.slots[index - 1]?.page ?? slot.page) > 1}
				<PaginationLink
					label={m['labels.more_subjects']({ subjects: m['nouns.page']({ count: 2 }) })}
					ellipsis>…</PaginationLink
				>
			{/if}
			<PaginationLink
				label={m['labels.page_number']({ number: slot.page })}
				href={slot.href}
				current={view.page === slot.page}>{slot.page}</PaginationLink
			>
		{/each}
		<PaginationLink
			label={m['labels.next_subject']({ subject: m['nouns.page']({ count: 1 }) })}
			href={view.nextHref ?? undefined}
			disabled={view.nextHref === null}>›</PaginationLink
		>
	</Pagination>
{/if}
