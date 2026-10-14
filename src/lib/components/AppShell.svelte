<script lang="ts">
	import { Select, Checkbox } from 'delightful-ui'
	import { getContext, type Snippet } from 'svelte'
	import { QuerySubscription } from 'jazz-tools/svelte'
	import { app } from '#lib/schema.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import QueryContent from './QueryContent.svelte'

	let { children }: { children: Snippet } = $props()
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const organizationQuery = new QuerySubscription(app.organizations.orderBy('name'))
	const accountQuery = new QuerySubscription(() =>
		filters.activeOrganizationId
			? app.accounts
					.where({ organizationId: filters.activeOrganizationId, archivedAt: { isNull: true } })
					.orderBy('name')
			: undefined
	)
	const organizations = $derived(organizationQuery.current ?? [])
	const activeAccounts = $derived(accountQuery.current ?? [])

	$effect(() => {
		if (organizationQuery.isLoading || organizationQuery.error || !organizationQuery.current) return
		if (organizations.some((organization) => organization.id === filters.activeOrganizationId))
			return
		filters.activeOrganizationId =
			organizations.find((organization) => organization.kind === 'personal')?.id ??
			organizations[0]?.id ??
			null
		filters.selectedAccountIds = null
	})

	function setActiveOrganization(value: string) {
		filters.activeOrganizationId = value || null
		filters.selectedAccountIds = null
	}

	function isAccountSelected(accountId: string) {
		return filters.selectedAccountIds === null || filters.selectedAccountIds.includes(accountId)
	}

	function setAccountSelected(accountId: string, checked: boolean) {
		if (checked && filters.selectedAccountIds === null) return

		const selected = new Set(
			filters.selectedAccountIds ?? activeAccounts.map((account) => account.id)
		)
		if (checked) selected.add(accountId)
		else selected.delete(accountId)
		filters.selectedAccountIds = [...selected]
	}

	function setAllAccountsSelected(checked: boolean) {
		filters.selectedAccountIds = checked ? null : []
	}
</script>

<div class="app-shell">
	<aside>
		<!-- Future navigation: docs/delightful-ui-integration.md#navigation -->
		<nav aria-label={m['navigation.label']()}>
			<ul>
				<li><a href="/">{m['navigation.overview']()}</a></li>
				<li><a href="/expenses">{m['labels.expenses']()}</a></li>
				<li><a href="/incomes">{m['labels.income']()}</a></li>
				<li><a href="/accounts">{m['labels.accounts']()}</a></li>
				<li><a href="/settings/categories">{m['labels.categories']()}</a></li>
				<li><a href="/settings/tags">{m['labels.tags']()}</a></li>
				<li><a href="/settings/workspace">{m['workspace.label']()}</a></li>
				<li><a href="/account">{m['navigation.account_recovery']()}</a></li>
				<li><a href="/login">{m['navigation.login']()}</a></li>
			</ul>
		</nav>

		<section aria-labelledby="account-filters-heading">
			<QueryContent
				queries={[organizationQuery]}
				loadingMessage={m['status.loading']({ subject: m['labels.workspaces']() })}
				errorMessage={m['errors.load']({ subject: m['labels.workspaces']() })}
			>
				<Select
					label={m['workspace.label']()}
					id="active-organization"
					value={filters.activeOrganizationId ?? ''}
					onchange={(event) => setActiveOrganization(event.currentTarget.value)}
				>
					{#each organizations as organization (organization.id)}
						<option value={organization.id}>{organization.name}</option>
					{/each}
				</Select>
			</QueryContent>

			<h2 id="account-filters-heading">{m['labels.accounts']()}</h2>
			<QueryContent
				queries={[organizationQuery, accountQuery]}
				loadingMessage={m['status.loading']({ subject: m['labels.accounts']() })}
				errorMessage={m['errors.load']({ subject: m['labels.accounts']() })}
			>
				{#if activeAccounts.length > 0}
					<ul>
						<li class="account-filter">
							<Checkbox
								checked={filters.selectedAccountIds === null ||
									activeAccounts.every((account) =>
										filters.selectedAccountIds?.includes(account.id)
									)}
								label={m['accounts.filters.all']()}
								onchange={(event) => setAllAccountsSelected(event.currentTarget.checked)}
							/>
						</li>
						{#each activeAccounts as account (account.id)}
							<li class="account-filter">
								<Checkbox
									checked={isAccountSelected(account.id)}
									label={account.name}
									aria-label={m['accounts.filters.toggle']({ name: account.name })}
									onchange={(event) => setAccountSelected(account.id, event.currentTarget.checked)}
								/>
							</li>
						{/each}
					</ul>
				{:else}
					<p>{m['accounts.sidebar_empty']()}</p>
				{/if}
			</QueryContent>
			<a href="/accounts/new">{m['actions.add_account']()}</a>
		</section>
	</aside>
	<main>{@render children()}</main>
</div>

<style>
	.app-shell {
		display: grid;
		grid-template-columns: 15rem minmax(0, 1fr);
		min-height: 100vh;
	}

	aside {
		padding: 1rem;
		border-right: 1px solid currentColor;
	}

	main {
		min-width: 0;
		padding: 1rem;
	}

	.account-filter {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	@media (max-width: 48rem) {
		.app-shell {
			grid-template-columns: minmax(0, 1fr);
		}

		aside {
			border-right: 0;
			border-bottom: 1px solid currentColor;
		}
	}
</style>
