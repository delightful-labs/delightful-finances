<script lang="ts">
	import { getContext } from 'svelte'
	import { useMachine } from '@xstate/svelte'
	import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { app, type Category } from '#lib/schema.js'
	import { archiveCategory } from '#lib/data.js'
	import { categoryArchiveSchema } from '#lib/validation/categories.js'
	import { createFormMachine } from '#lib/machines/form.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import QueryContent from './QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const db = getDb()
	const session = getJazzSession()
	const categories = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	// Count all readable history, regardless of sidebar account selection or tag archive state.
	const transactions = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.transactions.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const tags = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.tags.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const membership = new QuerySubscriptionOne(() => {
		const organizationId = filters.activeOrganizationId
		const userId = $session.account?.id
		return organizationId && userId
			? app.organizationMembers.where({ organizationId, userId })
			: undefined
	})
	const counts = $derived.by(() => {
		const result = new Map<string, { transactions: number; tags: number }>()
		for (const category of categories.current ?? [])
			result.set(category.id, { transactions: 0, tags: 0 })
		for (const transaction of transactions.current ?? []) {
			const count = result.get(transaction.categoryId)
			if (count) count.transactions += 1
		}
		for (const tag of tags.current ?? []) {
			const count = tag.categoryId ? result.get(tag.categoryId) : undefined
			if (count) count.tags += 1
		}
		return result
	})
	function canArchive(category: Category) {
		const member = membership.current
		return (
			!category.isSystem &&
			member?.organizationId === filters.activeOrganizationId &&
			(member.role === 'owner' || member.role === 'admin' || member.role === 'member')
		)
	}
	const { snapshot, send } = useMachine(
		createFormMachine(
			categoryArchiveSchema,
			async (values, { signal }) => {
				signal.throwIfAborted()
				const category = categories.current?.find((row) => row.id === values.categoryId)
				if (
					values.organizationId !== filters.activeOrganizationId ||
					!category ||
					!canArchive(category)
				)
					throw new Error('The category is not editable in the active workspace.')
				await archiveCategory(db, category.id)
				return category.name
			},
			undefined
		)
	)
	const archiving = $derived($snapshot.hasTag('busy'))
</script>

<h1>{m['labels.categories']()}</h1>
{#if $snapshot.matches('success') && $snapshot.context.result}
	<p role="status">{m['categories.archived']({ name: $snapshot.context.result })}</p>
{:else if $snapshot.matches('error') || $snapshot.matches('invalid')}
	<p role="alert">{m['errors.archive']({ subject: m['labels.category']() })}</p>
{/if}
<QueryContent
	queries={[categories, transactions, tags, membership]}
	loadingMessage={m['status.loading']({ subject: m['labels.categories']() })}
	errorMessage={m['errors.load']({ subject: m['labels.categories']() })}
>
	{#if categories.current?.length}
		<table>
			<thead
				><tr>
					<th scope="col">{m['labels.category_name']()}</th>
					<th scope="col">{m['labels.transaction_type']()}</th>
					<th scope="col">{m['labels.transactions']()}</th>
					<th scope="col">{m['labels.tags']()}</th>
					<th scope="col">{m['labels.actions']()}</th>
				</tr></thead
			>
			<tbody>
				{#each categories.current as category (category.id)}
					<tr>
						<th scope="row">{category.name}</th>
						<td>{category.kind === 'expense' ? m['labels.expenses']() : m['labels.income']()}</td>
						<td>{counts.get(category.id)?.transactions ?? 0}</td>
						<td>{counts.get(category.id)?.tags ?? 0}</td>
						<td
							>{#if canArchive(category)}
								<button
									type="button"
									disabled={archiving}
									aria-label={m['actions.archive_category']({ name: category.name })}
									onclick={() =>
										send({
											type: 'SUBMIT',
											values: { organizationId: category.organizationId, categoryId: category.id }
										})}
								>
									{archiving && $snapshot.context.validated?.value.categoryId === category.id
										? m['status.archiving']({ subject: m['labels.category']() })
										: m['actions.archive']()}
								</button>
							{/if}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p>{m['categories.empty']()}</p>
	{/if}
</QueryContent>
