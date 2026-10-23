<script lang="ts">
	import ExpensePieChart from './ExpensePieChart.svelte'
	import { Heading, Text } from 'delightful-ui'
	import DateRangeFilter from './DateRangeFilter.svelte'
	import CategoryLegend from './CategoryLegend.svelte'
	import TransactionItems from './TransactionItems.svelte'
	import type { TransactionRow } from '#lib/schema.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import { formatMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'
	let {
		transactions,
		categoryNames,
		tagNamesByTransaction
	}: {
		transactions: readonly TransactionRow[]
		categoryNames: ReadonlyMap<string, string>
		tagNamesByTransaction: ReadonlyMap<string, readonly string[]>
	} = $props()
	function daysAgo(days: number) {
		const date = new Date()
		date.setDate(date.getDate() - (days - 1))
		return todayDateOnly(date)
	}
	let start = $state(daysAgo(30))
	let end = $state(todayDateOnly())
	let selectedCategory = $state<string | null>(null)
	let selectedCurrency = $state('USD')
	const validRange = $derived(Boolean(start && end && start <= end))
	const period = $derived(
		validRange ? transactions.filter((row) => row.bookedOn >= start && row.bookedOn <= end) : []
	)
	const currencies = $derived([...new Set(period.map((row) => row.currency))].sort())
	const currency = $derived(
		currencies.includes(selectedCurrency) ? selectedCurrency : (currencies[0] ?? 'USD')
	)
	const expenses = $derived(period.filter((row) => row.currency === currency))
	const categoryIds = $derived([...new Set(transactions.map((row) => row.categoryId))].sort())
	// A shared perceptual lightness/chroma keeps the categorical palette cohesive.
	// Golden-angle hue spacing adds colors without cycling a fixed swatch list.
	function categoryColor(categoryId: string) {
		const index = categoryIds.indexOf(categoryId)
		const hue = (130 + index * 137.507764) % 360
		return `oklch(72% 0.17 ${hue})`
	}
	const slices = $derived.by(() => {
		const totals = new Map<string, number>()
		for (const row of expenses)
			totals.set(row.categoryId, (totals.get(row.categoryId) ?? 0) + row.amountMinor)
		return [...totals]
			.map(([key, value]) => ({
				key,
				value,
				label:
					categoryNames.get(key) ??
					m['status.unavailable_subject']({ subject: m['nouns.category']({ count: 1 }) }),
				color: categoryColor(key)
			}))
			.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
	})
	const activeCategory = $derived(
		slices.some((slice) => slice.key === selectedCategory) ? selectedCategory : null
	)
	const visible = $derived(
		expenses.filter((row) => activeCategory === null || row.categoryId === activeCategory)
	)
	const total = $derived(slices.reduce((sum, slice) => sum + slice.value, 0))
	function preset(days: number) {
		start = daysAgo(days)
		end = todayDateOnly()
		selectedCategory = null
	}
	function select(key: string) {
		selectedCategory = activeCategory === key ? null : key
	}
	const id = $props.id()
</script>

<section class="expense-overview" aria-labelledby={`${id}-title`}>
	<Heading level="h2" id={`${id}-title`}
		>{m['labels.subjects_by_subject']({
			subjects: m['nouns.expense']({ count: 2 }),
			subject: m['nouns.category']({ count: 1 })
		})}</Heading
	>
	<div class="filters">
		<DateRangeFilter
			{start}
			{end}
			onchange={(nextStart, nextEnd) => {
				start = nextStart
				end = nextEnd
				selectedCategory = null
			}}
			onpreset={preset}
		/>

		{#if currencies.length > 1}<label
				>{m['labels.currency']()}
				<select bind:value={selectedCurrency} onchange={() => (selectedCategory = null)}
					>{#each currencies as code (code)}<option value={code}>{code}</option>{/each}</select
				></label
			>{/if}
	</div>
	{#if !validRange}<p role="status">{m['errors.date_range_invalid']()}</p>
	{:else if expenses.length === 0}<Text
			>{m['labels.no_subjects_in_period']({ subjects: m['nouns.expense']({ count: 0 }) })}</Text
		>
	{:else}
		<div class="results">
			<div>
				<Text
					>{m['labels.total_subject_amount']({
						subject: m['nouns.expense']({ count: 2 }),
						amount: formatMoney(total, currency, getLocale())
					})}</Text
				>
				{#if total > 0}
					<div class="chart" aria-label={m['overview_expenses.chart']()}>
						{#key JSON.stringify(categoryIds)}
							<ExpensePieChart
								data={categoryIds.map((key) => ({
									key,
									value: slices.find((slice) => slice.key === key)?.value ?? 0,
									color: categoryColor(key)
								}))}
								onselect={select}
							/>
						{/key}
					</div>
				{/if}
				<CategoryLegend
					items={slices}
					selectedKey={activeCategory}
					{currency}
					allLabel={m['labels.all_subjects']({ subjects: m['nouns.category']({ count: 2 }) })}
					onselect={select}
					onclear={() => (selectedCategory = null)}
				/>
			</div>
			<section aria-labelledby={`${id}-transactions`}>
				<Heading level="h3" id={`${id}-transactions`}
					>{activeCategory
						? slices.find((slice) => slice.key === activeCategory)?.label
						: m['labels.subjects_in_period']({
								subjects: m['nouns.expense']({ count: 2 })
							})}</Heading
				>
				<TransactionItems
					transactions={visible}
					{categoryNames}
					{tagNamesByTransaction}
					transactionHref={(transactionId) => `/expenses/${encodeURIComponent(transactionId)}`}
				/>
			</section>
		</div>
	{/if}
</section>

<style>
	section {
		min-inline-size: 0;
	}
	.expense-overview {
		container: expense-overview / inline-size;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--dui-spacing-md);
		margin-block: var(--dui-spacing-md);
	}
	.results {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--dui-spacing-lg, 2rem);
		align-items: start;
	}
	.chart {
		block-size: 20rem;
	}
	@container expense-overview (min-width: 48rem) {
		.results {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}
</style>
