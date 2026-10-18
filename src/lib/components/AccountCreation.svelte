<script lang="ts">
	import { observeRow } from '#lib/observations.js'
	import { getContext, type Snippet } from 'svelte'
	import { fromStore } from 'svelte/store'
	import { getDb, getJazzSession, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import type { SnapshotFrom } from 'xstate'
	import type { Account } from '#lib/schema.js'
	import type {
		AccountCreationObservation,
		AccountCreationReason,
		AccountCreationScope
	} from '#lib/account-creation-contract.js'
	import { createScopedFormController } from '#lib/forms.svelte.js'
	import { createAccountCreationFormOptions } from '#lib/machines/account-creation-access.js'
	import { createAccount } from '#lib/data.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import AccountForm from './AccountForm.svelte'

	let { trigger }: { trigger?: Snippet<[() => void, boolean]> | undefined } = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const db = getDb()
	const session = fromStore(getJazzSession())
	const identityId = $derived(session.current.account?.id ?? null)
	const organizationId = $derived(filters.activeOrganizationId)
	const binding = $derived(session.current.client?.db ?? null)
	const scope = $derived({ identityId, organizationId, binding })
	const membership = new QuerySubscriptionOne(() =>
		organizationMembershipQuery(filters.activeOrganizationId, session.current.account?.id)
	)
	function observe(): AccountCreationObservation {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready',
			membership: observeRow(membership.current),
			loading: membership.isLoading,
			error: membership.error
		}
	}
	const options = createAccountCreationFormOptions({
		binding: db,
		observe,
		create: (id, values) => createAccount(db, id, values.name, values.kind)
	})
	const form = createScopedFormController<
		{ name: string; kind: 'cash' | 'bank' | 'card' },
		Account,
		AccountCreationReason,
		AccountCreationScope,
		AccountCreationObservation,
		SnapshotFrom<typeof options.availability>,
		SnapshotFrom<typeof options.operation>
	>(options)
</script>

<AccountForm
	{scope}
	{trigger}
	view={form.view}
	onopen={form.open}
	onsubmit={form.submit}
	onreset={form.reset}
	onRetryReadiness={form.retryReadiness}
/>
