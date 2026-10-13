<script lang="ts">
	import { onMount, type Snippet } from 'svelte'
	import { getDb } from 'jazz-tools/svelte'
	import { app, type Account, type Organization } from '#lib/schema.js'
	import type { FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'

	let { children, filters }: { children: Snippet; filters: FinanceFilters } = $props()
	let organizations = $state<Organization[]>([])
	let accounts = $state<Account[]>([])
	let organizationLoadError = $state(false)
	let accountLoadError = $state(false)
	const db = getDb()
	const dataLoadError = $derived(organizationLoadError || accountLoadError)

	onMount(() => {
		const unsubscribeOrganizations = db.subscribe(app.organizations.orderBy('name'), {
			onUpdate: (rows) => {
				organizations = rows
				organizationLoadError = false
				if (!rows.some((organization) => organization.id === filters.activeOrganizationId)) {
					filters.activeOrganizationId =
						rows.find((organization) => organization.kind === 'personal')?.id ?? rows[0]?.id ?? null
					filters.selectedAccountIds = null
				}
			},
			onError: () => {
				organizationLoadError = true
			}
		})
		const unsubscribeAccounts = db.subscribe(app.accounts.orderBy('name'), {
			onUpdate: (rows) => {
				accounts = rows.filter((account) => account.archivedAt == null)
				accountLoadError = false
			},
			onError: () => {
				accountLoadError = true
			}
		})
		return () => {
			unsubscribeOrganizations()
			unsubscribeAccounts()
		}
	})

	const activeAccounts = $derived(
		accounts.filter((account) => account.organizationId === filters.activeOrganizationId)
	)

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
		<nav aria-label={m['navigation.label']()}>
			<ul>
				<li><a href="/">{m['navigation.overview']()}</a></li>
				<li><a href="/expenses">{m['labels.expenses']()}</a></li>
				<li><a href="/incomes">{m['labels.income']()}</a></li>
				<li><a href="/accounts">{m['labels.accounts']()}</a></li>
				<li><a href="/settings/workspace">{m['workspace.label']()}</a></li>
				<li><a href="/account">{m['navigation.account_recovery']()}</a></li>
				<li><a href="/login">{m['navigation.login']()}</a></li>
			</ul>
		</nav>

		<section aria-labelledby="account-filters-heading">
			<label for="active-organization">{m['workspace.label']()}</label>
			<select
				id="active-organization"
				value={filters.activeOrganizationId ?? ''}
				onchange={(event) => setActiveOrganization(event.currentTarget.value)}
			>
				{#each organizations as organization (organization.id)}
					<option value={organization.id}>{organization.name}</option>
				{/each}
			</select>

			<h2 id="account-filters-heading">{m['labels.accounts']()}</h2>
			{#if dataLoadError}
				<p role="alert">{m['accounts.load_error']()}</p>
			{:else if activeAccounts.length > 0}
				<ul>
					<li class="account-filter">
						<span>{m['accounts.filters.all']()}</span>
						<input
							type="checkbox"
							checked={filters.selectedAccountIds === null ||
								activeAccounts.every((account) => filters.selectedAccountIds?.includes(account.id))}
							aria-label={m['accounts.filters.all']()}
							onchange={(event) => setAllAccountsSelected(event.currentTarget.checked)}
						/>
					</li>
					{#each activeAccounts as account (account.id)}
						<li class="account-filter">
							<span>{account.name}</span>
							<input
								type="checkbox"
								checked={isAccountSelected(account.id)}
								aria-label={m['accounts.filters.toggle']({ name: account.name })}
								onchange={(event) => setAccountSelected(account.id, event.currentTarget.checked)}
							/>
						</li>
					{/each}
				</ul>
			{:else}
				<p>{m['accounts.sidebar_empty']()}</p>
			{/if}
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
