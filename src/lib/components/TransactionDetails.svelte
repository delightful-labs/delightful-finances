<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { TransactionDetail } from '#lib/schema.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		transaction,
		form,
		creatorName,
		editorName
	}: {
		transaction: TransactionDetail | undefined | null
		form: Snippet
		creatorName: string | undefined
		editorName: string | undefined
	} = $props()
	const timestamps = $derived(
		new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' })
	)
</script>

{#if transaction}
	<p>
		<a href={transaction.kind === 'expense' ? '/expenses' : '/incomes'}>
			{transaction.kind === 'expense' ? m['labels.expenses']() : m['labels.income']()}
		</a>
	</p>
	{@render form()}
	<dl>
		<dt>{m['transactions.created_by']()}</dt>
		<dd>{creatorName ?? transaction.$createdBy.account}</dd>
		<dt>{m['transactions.created_at']()}</dt>
		<dd>
			<time datetime={transaction.$createdAt.toISOString()}
				>{timestamps.format(transaction.$createdAt)}</time
			>
		</dd>
		<dt>{m['transactions.updated_by']()}</dt>
		<dd>{editorName ?? transaction.$updatedBy.account}</dd>
		<dt>{m['transactions.updated_at']()}</dt>
		<dd>
			<time datetime={transaction.$updatedAt.toISOString()}
				>{timestamps.format(transaction.$updatedAt)}</time
			>
		</dd>
	</dl>
{:else}
	<p>{m['transactions.unavailable']()}</p>
{/if}
