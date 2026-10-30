<script lang="ts">
	import { observeRow, observeRows } from '#lib/observations.js'
	import { createScopedFormController } from '#lib/forms.svelte.js'
	import {
		createInternalTransferEntryFormOptions,
		selectInternalTransferEntryAccounts
	} from '#lib/machines/internal-transfer-entry.js'
	import type { InternalTransferEntryObservation } from '#lib/contracts/transfer-create-contract.js'
	import { app } from '#lib/schema.js'
	import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { getContext } from 'svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import { readinessKey, type ReadinessContext } from '#lib/bank-sync.js'
	import PairedTransferForm from './PairedTransferForm.svelte'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const readiness = getContext<ReadinessContext>(readinessKey)
	const db = getDb()
	const session = fromStore(getJazzSession())
	const accounts = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const categories = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.categories.where({
					organizationId: filters.activeOrganizationId,
					archivedAt: { isNull: true }
				})
			: undefined
	)
	const membership = new QuerySubscriptionOne(() =>
		organizationMembershipQuery(filters.activeOrganizationId, session.current.account?.id)
	)
	const grants = new QuerySubscription(() =>
		filters.activeOrganizationId && session.current.account?.id
			? app.accountMemberships.where({
					organizationId: filters.activeOrganizationId,
					userId: session.current.account.id
				})
			: undefined
	)
	function observe(): InternalTransferEntryObservation {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready' && session.current.client?.db === db,
			loading: [accounts, categories, membership, grants].some((query) => query.isLoading),
			failed: [accounts, categories, membership, grants].some((query) => query.error != null),
			accounts: observeRows(accounts.current),
			categories: observeRows(categories.current),
			membership: observeRow(membership.current),
			grants: observeRows(grants.current)
		}
	}
	const form = createScopedFormController(
		createInternalTransferEntryFormOptions({
			db,
			observe,
			trackWrite: (write) => readiness.actor.send({ type: 'TRANSFER_WRITE_TRACKED', write }),
			mutationGateway: { send: (event) => readiness.actor.send(event) }
		})
	)
	const writableAccounts = $derived(selectInternalTransferEntryAccounts(observe()))
</script>

<PairedTransferForm
	accounts={writableAccounts}
	view={form.view}
	onsubmit={form.submit}
	onreset={form.reset}
	oninput={form.input}
/>
