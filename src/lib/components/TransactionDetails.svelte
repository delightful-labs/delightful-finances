<script lang="ts">
	import type { TransactionDetail } from '#lib/queries/transaction-details.svelte.js'
	import { formatMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		transaction,
		creatorName,
		editorName
	}: {
		transaction: TransactionDetail | undefined | null
		creatorName: string | undefined
		editorName: string | undefined
	} = $props()
	const dates = $derived(
		new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeZone: 'UTC' })
	)
	const timestamps = $derived(
		new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' })
	)
	const paymentLabels = $derived({
		cash: m['transactions.payment.cash'](),
		check: m['transactions.payment.check'](),
		transfer: m['transactions.payment.transfer'](),
		electronic: m['transactions.payment.electronic']()
	})
</script>

{#if transaction}
	<p>
		<a href={transaction.kind === 'expense' ? '/expenses' : '/incomes'}>
			{transaction.kind === 'expense' ? m['labels.expenses']() : m['labels.income']()}
		</a>
	</p>
	<dl>
		<dt>{m['labels.transaction_type']()}</dt>
		<dd>{transaction.kind === 'expense' ? m['labels.expenses']() : m['labels.income']()}</dd>
		<dt>{m['labels.amount']()}</dt>
		<dd>{formatMoney(transaction.amountMinor, transaction.currency, getLocale())}</dd>
		<dt>{m['labels.date']()}</dt>
		<dd>
			<time datetime={transaction.bookedOn}
				>{dates.format(new Date(`${transaction.bookedOn}T00:00:00Z`))}</time
			>
		</dd>
		<dt>{m['labels.account']()}</dt>
		<dd>{transaction.account?.name ?? m['transactions.account_unavailable']()}</dd>
		<dt>{m['labels.category']()}</dt>
		<dd>{transaction.category?.name ?? m['transactions.category_unavailable']()}</dd>
		{#if transaction.tags?.length}
			<dt>{m['labels.tags']()}</dt>
			<dd>
				<ul>
					{#each transaction.tags as link (link.id)}
						<li>{link.tag?.name ?? m['transactions.tag_unavailable']()}</li>
					{/each}
				</ul>
			</dd>
		{/if}
		{#if transaction.memo}<dt>{m['labels.memo']()}</dt>
			<dd>{transaction.memo}</dd>{/if}
		{#if transaction.paymentMethod}
			<dt>{m['transactions.payment.method']()}</dt>
			<dd>{paymentLabels[transaction.paymentMethod]}</dd>
		{/if}
		{#if transaction.paymentMethod === 'check' && transaction.checkDetails?.[0]}
			{@const check = transaction.checkDetails[0]}
			<dt>{m['transactions.check.number']()}</dt>
			<dd>{check.checkNumber}</dd>
			{#if check.checkDate}
				<dt>{m['transactions.check.date']()}</dt>
				<dd>
					<time datetime={check.checkDate}
						>{dates.format(new Date(`${check.checkDate}T00:00:00Z`))}</time
					>
				</dd>
			{/if}
		{/if}
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
