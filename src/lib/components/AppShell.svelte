<script lang="ts">
	import { Button, Drawer, Navigation, Select, Checkbox, StatusMessage } from 'delightful-ui'
	import { onMount, tick, type ComponentProps, type Snippet } from 'svelte'
	import { page } from '$app/state'
	import type { Account, Organization } from '#lib/schema.js'
	import { m } from '#lib/paraglide/messages.js'
	import QueryContent from './QueryContent.svelte'

	let {
		children,
		syncConfigured,
		browserOffline,
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
		syncConfigured: boolean
		browserOffline: boolean
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
	const shellId = $props.id()
	const drawerId = `${shellId}-navigation`
	const toggleId = `${shellId}-toggle`
	const filtersHeadingId = `${shellId}-filters`
	let drawerOpen = $state(false)
	let drawerMode = $state<'inline' | 'overlay'>('inline')

	onMount(() => {
		const narrow = window.matchMedia('(max-width: 48rem)')
		drawerMode = narrow.matches ? 'overlay' : 'inline'
		drawerOpen = !narrow.matches
		function changeLayout() {
			drawerMode = narrow.matches ? 'overlay' : 'inline'
			// Keep mode transitions closed; the visible toggle can reopen either variant.
			drawerOpen = false
		}
		narrow.addEventListener('change', changeLayout)
		return () => narrow.removeEventListener('change', changeLayout)
	})

	async function restoreNavigationFocus() {
		await tick()
		if (!drawerOpen) document.getElementById(toggleId)?.focus()
	}

	function dismissOverlay(event: MouseEvent) {
		if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
		if (drawerMode === 'overlay') drawerOpen = false
	}

	function current(href: string) {
		return (
			href === '/'
				? page.url.pathname === '/'
				: page.url.pathname === href || page.url.pathname.startsWith(`${href}/`)
		)
			? 'page'
			: undefined
	}
</script>

<div class="app-shell">
	<Drawer
		id={drawerId}
		triggerId={toggleId}
		heading={m['navigation.label']()}
		headingHidden
		closeLabel={m['navigation.close']()}
		mode={drawerMode}
		bind:open={drawerOpen}
		onclose={restoreNavigationFocus}
		style="--dui-drawer-width: 20rem"
	>
		<div class="sidebar-content">
			<Navigation label={m['navigation.label']()}>
				<li>
					<a href="/" aria-current={current('/')} onclick={dismissOverlay}
						>{m['navigation.overview']()}</a
					>
				</li>
				<li>
					<a href="/expenses" aria-current={current('/expenses')} onclick={dismissOverlay}
						>{m['labels.expenses']()}</a
					>
				</li>
				<li>
					<a href="/incomes" aria-current={current('/incomes')} onclick={dismissOverlay}
						>{m['labels.income']()}</a
					>
				</li>
				<li>
					<a href="/accounts" aria-current={current('/accounts')} onclick={dismissOverlay}
						>{m['labels.accounts']()}</a
					>
				</li>
				<li>
					<a
						href="/settings/categories"
						aria-current={current('/settings/categories')}
						onclick={dismissOverlay}>{m['labels.categories']()}</a
					>
				</li>
				<li>
					<a href="/settings/tags" aria-current={current('/settings/tags')} onclick={dismissOverlay}
						>{m['labels.tags']()}</a
					>
				</li>
				<li>
					<a
						href="/settings/workspace"
						aria-current={current('/settings/workspace')}
						onclick={dismissOverlay}>{m['workspace.label']()}</a
					>
				</li>
				<li>
					<a href="/account" aria-current={current('/account')} onclick={dismissOverlay}
						>{m['navigation.account_recovery']()}</a
					>
				</li>
				<li>
					<a href="/login" aria-current={current('/login')} onclick={dismissOverlay}
						>{m['navigation.login']()}</a
					>
				</li>
			</Navigation>

			<section aria-labelledby={filtersHeadingId}>
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

				<h2 id={filtersHeadingId}>{m['labels.accounts']()}</h2>
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
				<a href="/accounts/new" aria-current={current('/accounts/new')} onclick={dismissOverlay}
					>{m['actions.add_account']()}</a
				>
			</section>
			<div class="sidebar-status">
				<StatusMessage
					compact
					text={!syncConfigured
						? m['database.local']()
						: browserOffline
							? m['database.offline']()
							: m['database.sync_enabled']()}
				/>
			</div>
		</div>
	</Drawer>
	<main>
		<div class="shell-controls" data-open={drawerOpen} inert={drawerOpen} aria-hidden={drawerOpen}>
			<Button
				id={toggleId}
				type="button"
				aria-controls={drawerId}
				aria-expanded={drawerOpen}
				onclick={() => (drawerOpen = !drawerOpen)}>{m['navigation.open']()}</Button
			>
		</div>
		<div class="page-content">{@render children()}</div>
	</main>
</div>

<style>
	.shell-controls {
		display: flex;
		gap: var(--dui-space-xs, 0.5rem);
		min-block-size: var(--dui-button-min-height, 44px);
	}

	.shell-controls[data-open='true'] {
		visibility: hidden;
	}

	.app-shell {
		display: flex;
		align-items: flex-start;
		gap: var(--dui-space-sm, 1rem);
		min-height: 100vh;
	}

	.sidebar-content {
		display: flex;
		flex-direction: column;
		min-block-size: 100%;
		gap: var(--dui-space-sm, 1rem);
	}

	.sidebar-status {
		margin-block-start: auto;
	}

	section,
	section ul {
		display: grid;
		gap: var(--dui-space-sm, 1rem);
		min-width: 0;
	}

	section ul {
		list-style: none;
		margin: 0;
		padding: 0;
		gap: var(--dui-space-xs, 0.5rem);
	}

	h2,
	p {
		margin: 0;
	}

	main {
		display: grid;
		align-content: start;
		gap: var(--dui-space-sm, 1rem);
		flex: 1;
		min-width: 0;
		padding: var(--dui-space-sm, 1rem);
	}

	.page-content {
		min-inline-size: 0;
	}

	.account-filter {
		display: flex;
		align-items: center;
		gap: var(--dui-space-xs, 0.5rem);
	}
</style>
