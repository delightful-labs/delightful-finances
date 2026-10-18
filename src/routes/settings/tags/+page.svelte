<script lang="ts">
	import { observeRow, observeRows } from '#lib/observations.js'
	import { createScopedFormController } from '#lib/forms.svelte.js'
	import { tagArchiveSchema, tagFormSchema } from '#lib/validation/tags.js'
	import { createSingleWriteFormOptions } from '#lib/machines/scoped-form-policy.js'
	import {
		createManagementAvailability,
		selectManagementAvailability,
		managementScope,
		sameManagementScope,
		selectManagementArchiveIds
	} from '#lib/machines/management.js'
	import type {
		ManagementObservation,
		ManagementReason,
		ManagementScope
	} from '#lib/management-contract.js'
	import type { SnapshotFrom } from 'xstate'
	import { archiveTag, createTag } from '#lib/data.js'
	import { app, type Tag } from '#lib/schema.js'
	import type { z } from 'zod'
	import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import TagForm from '#lib/components/TagForm.svelte'
	import TagList from '#lib/components/TagList.svelte'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)

	const db = getDb()
	const tags = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.tags
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	// Archived categories retain their labels in tag history.
	const categories = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories.where({ organizationId: filters.activeOrganizationId })
			: undefined
	)
	const categoryNames = $derived(
		new Map((categories.current ?? []).map((category) => [category.id, category.name]))
	)
	const session = fromStore(getJazzSession())
	const membership = new QuerySubscriptionOne(() => {
		const userId = session.current.account?.id
		const organizationId = filters.activeOrganizationId
		return organizationMembershipQuery(organizationId, userId)
	})
	const availableCategories = $derived(
		(categories.current ?? [])
			.filter((c) => c.organizationId === filters.activeOrganizationId && !c.archivedAt)
			.toSorted((a, b) => a.name.localeCompare(b.name))
	)

	const identityId = $derived(session.current.account?.id ?? null)
	const organizationId = $derived(filters.activeOrganizationId)
	const binding = $derived(session.current.client?.db ?? null)
	const scope = $derived({ identityId, organizationId, binding })
	function observe(): ManagementObservation {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready',
			membership: observeRow(membership.current),
			loading: [membership, categories, tags].some((q) => q.isLoading),
			failed: [membership, categories, tags].some((q) => q.error != null),
			categories: observeRows(categories.current),
			tags: observeRows(tags.current)
		}
	}
	const availability = createManagementAvailability(db)
	const common = {
		availability,
		selectAvailability: selectManagementAvailability,
		scopeOf: managementScope,
		sameScope: sameManagementScope,
		observe,
		classifyBlocked: (reason: ManagementReason): 'denied' | 'unavailable' =>
			reason === 'readOnly' || reason === 'protectedRecord' ? 'denied' : 'unavailable'
	}

	const options = createSingleWriteFormOptions<
		z.output<typeof tagFormSchema>,
		Tag,
		ManagementReason,
		ManagementScope,
		ManagementObservation,
		SnapshotFrom<typeof availability>
	>({
		...common,
		schema: tagFormSchema,
		mode: 'create',
		successContent: 'replace',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			intent: { kind: 'createTag', categoryId: request.values.categoryId }
		}),
		write: async ({ request }) => {
			const id = request.scope.organizationId
			if (id === null) throw new Error('Missing authorized workspace')
			return createTag(db, id, request.values.name, request.values.categoryId)
		}
	})
	const form = createScopedFormController<
		z.output<typeof tagFormSchema>,
		Tag,
		ManagementReason,
		ManagementScope,
		ManagementObservation,
		SnapshotFrom<typeof availability>,
		SnapshotFrom<typeof options.operation>
	>(options)
	const archiveOptions = createSingleWriteFormOptions<
		z.output<typeof tagArchiveSchema>,
		string,
		ManagementReason,
		ManagementScope,
		ManagementObservation,
		SnapshotFrom<typeof availability>
	>({
		...common,
		schema: tagArchiveSchema,
		mode: 'create',
		successContent: 'retain',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			intent: {
				kind: 'archiveTag',
				id: request.values.tagId,
				organizationId: request.values.organizationId
			}
		}),
		write: async ({ request, observation }) => {
			const row = observation.facts.tags.find((row) => row.id === request.values.tagId)
			if (!row) throw new Error('Missing authorized record')
			await archiveTag(db, row.id)
			return row.name
		}
	})
	const archive = createScopedFormController<
		z.output<typeof tagArchiveSchema>,
		string,
		ManagementReason,
		ManagementScope,
		ManagementObservation,
		SnapshotFrom<typeof availability>,
		SnapshotFrom<typeof archiveOptions.operation>
	>(archiveOptions)
	const archivableIds = $derived(selectManagementArchiveIds(observe(), db, 'archiveTag'))
	function onArchive(id: string) {
		archive.submitValues({ tagId: id, organizationId: filters.activeOrganizationId })
	}
</script>

<svelte:head>
	<title>{m['labels.tags']()} · {m['app.name']()}</title>
</svelte:head>

<PageHeader title={m['labels.tags']()} />
<QueryContent
	queries={[membership, tags, categories]}
	loadingMessage={m['status.loading']({ subject: m['labels.tags']() })}
	errorMessage={m['errors.load']({ subject: m['labels.tags']() })}
>
	{#if filters.activeOrganizationId && membership.current}
		<TagList
			tags={tags.current ?? []}
			{categoryNames}
			archivableTagIds={archivableIds}
			archiveView={archive.view}
			{onArchive}
		/>
	{/if}
</QueryContent>

<TagForm
	{scope}
	view={form.view}
	onopen={form.open}
	onsubmit={form.submit}
	onreset={form.reset}
	onRetryReadiness={form.retryReadiness}
	categories={availableCategories}
/>
