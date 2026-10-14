<script lang="ts">
	import { Button } from 'delightful-ui'
	import { getContext } from 'svelte'
	import { useMachine } from '@xstate/svelte'
	import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { app } from '#lib/schema.js'
	import { archiveTag } from '#lib/data.js'
	import { tagArchiveSchema } from '#lib/validation/tags.js'
	import { createFormMachine } from '#lib/machines/form.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import QueryContent from './QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const db = getDb()
	const session = getJazzSession()
	const tags = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.tags
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	// Retain category labels even when the associated category has been archived.
	const categories = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const categoryNames = $derived(
		new Map((categories.current ?? []).map((category) => [category.id, category.name]))
	)
	const membership = new QuerySubscriptionOne(() => {
		const organizationId = filters.activeOrganizationId
		const userId = $session.account?.id
		return organizationId && userId
			? app.organizationMembers.where({ organizationId, userId })
			: undefined
	})
	const canArchive = $derived(
		membership.current?.organizationId === filters.activeOrganizationId &&
			(membership.current?.role === 'owner' ||
				membership.current?.role === 'admin' ||
				membership.current?.role === 'member')
	)
	const { snapshot, send } = useMachine(
		createFormMachine(
			tagArchiveSchema,
			async (values, { signal }) => {
				signal.throwIfAborted()
				const tag = tags.current?.find((row) => row.id === values.tagId)
				if (values.organizationId !== filters.activeOrganizationId || !tag || !canArchive)
					throw new Error('The tag is not editable in the active workspace.')
				await archiveTag(db, tag.id)
				return tag.name
			},
			undefined
		)
	)
	const archiving = $derived($snapshot.hasTag('busy'))
</script>

<h1>{m['labels.tags']()}</h1>
{#if $snapshot.matches('success') && $snapshot.context.result}
	<p role="status">{m['tags.archived']({ name: $snapshot.context.result })}</p>
{:else if $snapshot.matches('error') || $snapshot.matches('invalid')}
	<p role="alert">{m['errors.archive']({ subject: m['labels.tag']() })}</p>
{/if}
<QueryContent
	queries={[tags, categories, membership]}
	loadingMessage={m['status.loading']({ subject: m['labels.tags']() })}
	errorMessage={m['errors.load']({ subject: m['labels.tags']() })}
>
	{#if tags.current?.length}
		<table>
			<thead
				><tr>
					<th scope="col">{m['labels.tag_name']()}</th>
					<th scope="col">{m['labels.category']()}</th>
					<th scope="col">{m['labels.actions']()}</th>
				</tr></thead
			>
			<tbody>
				{#each tags.current as tag (tag.id)}
					<tr>
						<th scope="row">{tag.name}</th>
						<td
							>{tag.categoryId
								? (categoryNames.get(tag.categoryId) ?? m['tags.category_unavailable']())
								: m['tags.no_category']()}</td
						>
						<td
							>{#if canArchive}
								<Button
									type="button"
									disabled={archiving}
									aria-label={m['actions.archive_tag']({ name: tag.name })}
									onclick={() =>
										send({
											type: 'SUBMIT',
											values: { organizationId: tag.organizationId, tagId: tag.id }
										})}
								>
									{archiving && $snapshot.context.validated?.value.tagId === tag.id
										? m['status.archiving']({ subject: m['labels.tag']() })
										: m['actions.archive']()}
								</Button>
							{/if}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p>{m['tags.empty']()}</p>
	{/if}
</QueryContent>
