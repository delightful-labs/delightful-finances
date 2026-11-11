<script lang="ts">
	import { untrack, type Snippet } from 'svelte'
	import type {
		PublicOverviewView,
		OverviewCommand
	} from '#lib/runtime/worker/overview-protocol.js'
	import CatalogPager from '../navigation/CatalogPager.svelte'
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import { EXPENSES_PATH } from '#lib/domain/transaction-kind.js'
	import ExpensePieChart from './ExpensePieChart.svelte'
	import { Heading, Text, InputText, Select } from 'delightful-ui'
	import FilterPopovers from '../filters/FilterPopovers.svelte'
	import { filterTransactions } from '#lib/filters/transaction-list-filters.js'
	import DateRangeFilter from '../filters/DateRangeFilter.svelte'
	import CategoryLegend from './CategoryLegend.svelte'
	import TransactionItems from '../transactions/TransactionItems.svelte'
	import type { TransactionRow } from '#lib/schema.js'
	import type { InternalTransferResolution } from '#lib/domain/internal-transfer.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import { formatMoney, formatSignedMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import { m } from '#lib/paraglide/messages.js'
	let {
		navigation = emptyNavigation,
		transactions = [],
		categoryNames = new Map(),
		tagNamesByTransaction = new Map(),
		internalTransferResolution = {
			effectiveLinks: [],
			pendingLinks: [],
			conflictedLinks: [],
			suppressedTransactionIds: new Set<string>()
		},
		projection,
		onintent = () => {},
		filters = null,
		onfilterschange = () => {}
	}: {
		navigation?: Snippet | undefined
		transactions?: readonly TransactionRow[]
		categoryNames?: ReadonlyMap<string, string>
		tagNamesByTransaction?: ReadonlyMap<string, readonly string[]>
		internalTransferResolution?: InternalTransferResolution
		projection?: PublicOverviewView
		onintent?: (command: OverviewCommand) => void
		filters?: { start: string; end: string; categoryId: string | null; currency: string } | null
		onfilterschange?: (filters: {
			start: string
			end: string
			categoryId: string | null
			currency: string
		}) => void
	} = $props()
	function daysAgo(days: number) {
		const date = new Date()
		date.setDate(date.getDate() - (days - 1))
		return todayDateOnly(date)
	}
	let query = $state('')
	let start = $state(untrack(() => (projection ? '' : daysAgo(30))))
	let end = $state(untrack(() => (projection ? '' : todayDateOnly())))
	let selectedCategory = $state<string | null>(null)
	let selectedCurrency = $state('USD')
	$effect(() => {
		if (!filters || projection) return
		start = filters.start
		end = filters.end
		selectedCategory = filters.categoryId
		selectedCurrency = filters.currency
	})
	$effect(() => {
		if (!projection)
			onfilterschange({ start, end, categoryId: selectedCategory, currency: selectedCurrency })
	})
	const validRange = $derived(projection?.validRange ?? Boolean(start && end && start <= end))
	const unlinkedTransactions = $derived(
		projection
			? []
			: filterTransactions(
					transactions.filter(
						(row) => !internalTransferResolution.suppressedTransactionIds.has(row.id)
					),
					{ query, start: '', end: '', categoryId: '', currency: '' },
					categoryNames,
					tagNamesByTransaction
				)
	)
	const period = $derived(
		validRange
			? unlinkedTransactions.filter((row) => row.bookedOn >= start && row.bookedOn <= end)
			: []
	)
	const categoryOptions = $derived(
		projection ? projection.categories : [...categoryNames].map(([id, name]) => ({ id, name }))
	)
	const currencies = $derived(
		projection?.currencies ?? [...new Set(period.map((row) => row.currency))].sort()
	)
	const currency = $derived(
		projection?.currency ??
			(currencies.includes(selectedCurrency) ? selectedCurrency : (currencies[0] ?? 'USD'))
	)
	const expenses = $derived(period.filter((row) => row.currency === currency))
	const categoryIds = $derived(
		[...new Set(unlinkedTransactions.map((row) => row.categoryId))].sort()
	)
	// A shared perceptual lightness/chroma keeps the categorical palette cohesive.
	// Golden-angle hue spacing adds colors without cycling a fixed swatch list.
	function categoryColor(categoryId: string) {
		const index = categoryIds.indexOf(categoryId)
		const hue = (130 + index * 137.507764) % 360
		return `oklch(72% 0.17 ${hue})`
	}
	const slices = $derived.by(() => {
		if (projection)
			return projection.slices.map((slice) => ({
				...slice,
				label:
					slice.label ??
					m['status.unavailable_subject']({ subject: m['nouns.category']({ count: 1 }) })
			}))
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
		projection
			? projection.activeCategory
			: slices.some((slice) => slice.key === selectedCategory)
				? selectedCategory
				: null
	)
	const visible = $derived(
		expenses.filter((row) => activeCategory === null || row.categoryId === activeCategory)
	)
	const total = $derived(projection?.total ?? 0n)
	const totalLabel = $derived(
		projection
			? formatSignedMoney(total, currency, getLocale())
			: formatMoney(
					expenses.reduce((sum, row) => sum + row.amountMinor, 0),
					currency,
					getLocale()
				)
	)
	function preset(days: number) {
		if (projection) {
			if (days === 7 || days === 30) onintent({ type: 'PRESET', days })
			return
		}
		start = daysAgo(days)
		end = todayDateOnly()
		selectedCategory = null
	}
	function select(key: string) {
		if (projection) {
			const arc = projection.chart.find((arc) => arc.key === key)
			if (arc?.pageOffset !== null && arc?.pageOffset !== undefined)
				onintent({ type: 'CATEGORY_PAGE', offset: arc.pageOffset })
			else onintent({ type: 'CATEGORY', categoryId: activeCategory === key ? null : key })
			return
		}
		selectedCategory = activeCategory === key ? null : key
	}
	const id = $props.id()
</script>

{#snippet emptyNavigation()}{/snippet}

<PageLayout {navigation}>
	{#snippet pageHeading()}
		<div class="overview-header">
			<Heading level="h1">{m['navigation.overview']()}</Heading>
			<FilterPopovers>
				{#snippet search()}
					<InputText
						label={m['actions.search_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
						type="search"
						{...projection ? { maxlength: 4096 } : {}}
						value={projection?.filters.query ?? query}
						oninput={(event) => {
							if (projection) onintent({ type: 'SEARCH', query: event.currentTarget.value })
							else query = event.currentTarget.value
						}}
					/>
				{/snippet}
				{#snippet filters()}
					<DateRangeFilter
						start={projection?.filters.start ?? start}
						end={projection?.filters.end ?? end}
						preset={projection?.preset}
						onchange={(nextStart, nextEnd) => {
							if (projection) {
								onintent({ type: 'RANGE', start: nextStart, end: nextEnd })
								return
							}
							start = nextStart
							end = nextEnd
							selectedCategory = null
						}}
						onpreset={preset}
					/>

					{#if currencies.length > 1}<label
							>{m['labels.currency']()}
							<select
								value={projection?.currency ?? selectedCurrency}
								onchange={(event) => {
									if (projection)
										onintent({ type: 'CURRENCY', currency: event.currentTarget.value })
									else {
										selectedCurrency = event.currentTarget.value
										selectedCategory = null
									}
								}}
								>{#each currencies as code (code)}<option value={code}>{code}</option
									>{/each}</select
							></label
						>{/if}
					<Select
						label={m['actions.filter_subject']({ subject: m['nouns.category']({ count: 1 }) })}
						value={(projection ? projection.activeCategory : selectedCategory) ?? ''}
						onchange={(event) => {
							if (projection)
								onintent({ type: 'CATEGORY', categoryId: event.currentTarget.value || null })
							else selectedCategory = event.currentTarget.value || null
						}}
					>
						<option value=""
							>{m['labels.all_subjects']({ subjects: m['nouns.category']({ count: 2 }) })}</option
						>
						{#if projection?.activeCategory && !categoryOptions.some((option) => option.id === projection.activeCategory)}
							<option value={projection.activeCategory}
								>{projection.activeCategoryName ??
									m['status.unavailable_subject']({
										subject: m['nouns.category']({ count: 1 })
									})}</option
							>
						{/if}
						{#each categoryOptions as option (option.id)}
							<option value={option.id}
								>{option.name ??
									m['status.unavailable_subject']({
										subject: m['nouns.category']({ count: 1 })
									})}</option
							>
						{/each}
					</Select>
				{/snippet}
			</FilterPopovers>
		</div>
	{/snippet}

	<section class="expense-overview" aria-labelledby={`${id}-title`}>
		<Heading level="h2" id={`${id}-title`}
			>{m['labels.subjects_by_subject']({
				subjects: m['nouns.expense']({ count: 2 }),
				subject: m['nouns.category']({ count: 1 })
			})}</Heading
		>
		{#if !validRange}<p role="status">{m['errors.date_range_invalid']()}</p>
		{:else if (projection?.transactionCount ?? expenses.length) === 0}<Text
				>{m['labels.no_subjects_in_period']({ subjects: m['nouns.expense']({ count: 0 }) })}</Text
			>
		{:else}
			<div class="results">
				<div>
					<Text
						>{m['labels.total_subject_amount']({
							subject: m['nouns.expense']({ count: 2 }),
							amount: totalLabel
						})}</Text
					>
					{#if projection ? total > 0n : expenses.some((row) => row.amountMinor > 0)}
						<div class="chart" aria-label={m['overview_expenses.chart']()}>
							{#if projection}
								<ExpensePieChart projection={projection.chart} onselect={select} />
							{:else}
								{#key JSON.stringify(categoryIds)}
									<ExpensePieChart
										data={categoryIds.map((key) => ({
											key,
											value: Number(slices.find((slice) => slice.key === key)?.value ?? 0),
											color: categoryColor(key)
										}))}
										onselect={select}
									/>
								{/key}
							{/if}
						</div>
					{/if}
					<CategoryLegend
						items={slices}
						selectedKey={activeCategory}
						{currency}
						allLabel={m['labels.all_subjects']({ subjects: m['nouns.category']({ count: 2 }) })}
						onselect={select}
						onclear={() => {
							if (projection) onintent({ type: 'CATEGORY', categoryId: null })
							else selectedCategory = null
						}}
					/>
					{#if projection}<CatalogPager
							page={projection.categoryPage}
							size={500}
							subject={m['nouns.category']({ count: 2 })}
							onpage={(offset) => onintent({ type: 'CATEGORY_PAGE', offset })}
						/>{/if}
				</div>
				<section aria-labelledby={`${id}-transactions`}>
					<Heading level="h3" id={`${id}-transactions`}
						>{activeCategory
							? (projection?.activeCategoryName ??
								slices.find((slice) => slice.key === activeCategory)?.label ??
								m['status.unavailable_subject']({ subject: m['nouns.category']({ count: 1 }) }))
							: m['labels.subjects_in_period']({
									subjects: m['nouns.expense']({ count: 2 })
								})}</Heading
					>
					{#if projection}
						<TransactionItems
							projection={projection.ledger}
							onTagPage={(transactionId, offset) =>
								onintent({ type: 'TAG_PAGE', transactionId, offset })}
						/>
					{:else}
						<TransactionItems
							transactions={visible}
							{categoryNames}
							{tagNamesByTransaction}
							transactionHref={(transactionId) =>
								`${EXPENSES_PATH}/${encodeURIComponent(transactionId)}`}
						/>
					{/if}
				</section>
			</div>
		{/if}
	</section>
</PageLayout>

<style>
	section {
		min-inline-size: 0;
	}
	.expense-overview {
		container: expense-overview / inline-size;
	}
	.overview-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--dui-spacing-md);
		justify-content: space-between;
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
