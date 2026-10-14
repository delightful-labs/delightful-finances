<script lang="ts">
	import { Select, Checkbox } from 'delightful-ui'
	import type { ComponentProps, Snippet } from 'svelte'
	import type { Account, Organization } from '#lib/schema.js'
	import { m } from '#lib/paraglide/messages.js'
	import QueryContent from './QueryContent.svelte'

	let {
		children,
		organizations,
		accounts,
		organizationId,
		selectedAccountIds,
		organizationQueries,
		accountQueries,
		onOrganizationChange,
		onAccountChange,
		onAllAccountsChange
	}: {
		children: Snippet
		organizations: readonly Organization[]
		accounts: readonly Account[]
		organizationId: string | null
		selectedAccountIds: readonly string[] | null
		organizationQueries: ComponentProps<typeof QueryContent>['queries']
		accountQueries: ComponentProps<typeof QueryContent>['queries']
		onOrganizationChange: (value: string) => void
		onAccountChange: (accountId: string, checked: boolean) => void
		onAllAccountsChange: (checked: boolean) => void
	} = $props()
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
				queries={organizationQueries}
				loadingMessage={m['status.loading']({ subject: m['labels.workspaces']() })}
				errorMessage={m['errors.load']({ subject: m['labels.workspaces']() })}
			>
				<Select
					label={m['workspace.label']()}
					id="active-organization"
					value={organizationId ?? ''}
					onchange={(event) => onOrganizationChange(event.currentTarget.value)}
				>
					{#each organizations as organization (organization.id)}
						<option value={organization.id}>{organization.name}</option>
					{/each}
				</Select>
			</QueryContent>

			<h2 id="account-filters-heading">{m['labels.accounts']()}</h2>
			<QueryContent
				queries={accountQueries}
				loadingMessage={m['status.loading']({ subject: m['labels.accounts']() })}
				errorMessage={m['errors.load']({ subject: m['labels.accounts']() })}
			>
				{#if accounts.length > 0}
					<ul>
						<li class="account-filter">
							<Checkbox
								checked={selectedAccountIds === null ||
									accounts.every((account) => selectedAccountIds?.includes(account.id))}
								label={m['accounts.filters.all']()}
								onchange={(event) => onAllAccountsChange(event.currentTarget.checked)}
							/>
						</li>
						{#each accounts as account (account.id)}
							<li class="account-filter">
								<Checkbox
									checked={selectedAccountIds === null || selectedAccountIds.includes(account.id)}
									label={account.name}
									aria-label={m['accounts.filters.toggle']({ name: account.name })}
									onchange={(event) => onAccountChange(account.id, event.currentTarget.checked)}
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
