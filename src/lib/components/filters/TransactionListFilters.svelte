<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import type { TransactionListFilters } from '#lib/filters/transaction-list-filters.js'
	import DateRangeFilter from './DateRangeFilter.svelte'
	import { InputText, Select } from 'delightful-ui'
	let {
		value,
		categories,
		currencies,
		onchange
	}: {
		value: TransactionListFilters
		categories: ReadonlyMap<string, string>
		currencies: readonly string[]
		onchange: (value: TransactionListFilters) => void
	} = $props()
</script>

<fieldset>
	<legend>{m['actions.filter_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}</legend>
	<InputText
		label={m['actions.search_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
		type="search"
		value={value.query}
		oninput={(event) => onchange({ ...value, query: event.currentTarget.value })}
	/>
	<DateRangeFilter
		start={value.start}
		end={value.end}
		onchange={(start, end) => onchange({ ...value, start, end })}
		onpreset={(days) => {
			const date = new Date()
			date.setDate(date.getDate() - (days - 1))
			onchange({ ...value, start: todayDateOnly(date), end: todayDateOnly() })
		}}
	/>
	<Select
		label={m['actions.filter_subject']({ subject: m['nouns.category']({ count: 1 }) })}
		value={value.categoryId}
		onchange={(event) => onchange({ ...value, categoryId: event.currentTarget.value })}
	>
		<option value=""
			>{m['labels.all_subjects']({ subjects: m['nouns.category']({ count: 2 }) })}</option
		>
		{#each [...categories] as [id, name] (id)}<option value={id}>{name}</option>{/each}
	</Select>
	{#if currencies.length > 1}
		<Select
			label={m['actions.filter_subject']({ subject: m['labels.currency']() })}
			value={value.currency}
			onchange={(event) => onchange({ ...value, currency: event.currentTarget.value })}
		>
			<option value="">{m['archive_filter.all']()}</option>
			{#each currencies as code (code)}<option value={code}>{code}</option>{/each}
		</Select>
	{/if}
</fieldset>

<style>
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		min-inline-size: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--dui-spacing-md);
	}

	legend {
		padding: 0;
	}
</style>
