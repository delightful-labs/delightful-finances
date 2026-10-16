<script lang="ts">
	import {
		Button,
		Drawer,
		Navigation,
		Select,
		Checkbox,
		StatusMessage,
		TopNavigation,
		ScreenReaderText
	} from 'delightful-ui'
	import { onMount, type ComponentProps, type Snippet } from 'svelte'
	import { page } from '$app/state'
	import type { BankSyncControls } from '#lib/bank-sync.js'
	import type { Account, Organization } from '#lib/schema.js'
	import { m } from '#lib/paraglide/messages.js'
	import QueryContent from './QueryContent.svelte'

	let {
		children,
		bankSync,
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
		bankSync: BankSyncControls
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
	let topNavigationHeight = $state(56)

	onMount(() => {
		const resizeObserver = new ResizeObserver(([entry]) => {
			if (!entry) return
			const borderBox = entry.borderBoxSize[0]
			topNavigationHeight = borderBox?.blockSize ?? entry.contentRect.height
		})
		const siteHeader = document.querySelector<HTMLElement>('[data-top-navigation-root]')
		if (siteHeader) resizeObserver.observe(siteHeader)
		return () => resizeObserver.disconnect()
	})

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

<div class="app-shell" style="--dui-top-navigation-height: {topNavigationHeight}px">
	<TopNavigation sticky class="site-header">
		<Button
			class="navigation-toggle"
			id={toggleId}
			type="button"
			aria-controls={drawerId}
			aria-expanded={drawerOpen}
			onclick={() => (drawerOpen = !drawerOpen)}
		>
			<ScreenReaderText>{m['navigation.toggle']()}</ScreenReaderText>
			<span aria-hidden="true">{drawerOpen ? '×' : '☰'}</span>
		</Button>
		<strong>{m['app.name']()}</strong>
	</TopNavigation>
	<div class="workspace" data-drawer-open={drawerOpen}>
		<Drawer
			class="site-drawer"
			id={drawerId}
			heading={m['navigation.label']()}
			headingHidden
			closeLabel={m['navigation.close']()}
			showCloseButton={false}
			style="--dui-drawer-width: 20rem; --dui-drawer-height: calc(100vh - var(--dui-top-navigation-height)); --dui-drawer-top: var(--dui-top-navigation-height)"
			bind:open={drawerOpen}
		>
			<div class="sidebar-content">
				<Navigation label={m['navigation.label']()}>
					<li>
						<a href="/" aria-current={current('/')} onclick={() => (drawerOpen = false)}
							>{m['navigation.overview']()}</a
						>
					</li>
					<li>
						<a
							href="/expenses"
							aria-current={current('/expenses')}
							onclick={() => (drawerOpen = false)}>{m['labels.expenses']()}</a
						>
					</li>
					<li>
						<a
							href="/incomes"
							aria-current={current('/incomes')}
							onclick={() => (drawerOpen = false)}>{m['labels.income']()}</a
						>
					</li>
					<li>
						<a
							href="/accounts"
							aria-current={current('/accounts')}
							onclick={() => (drawerOpen = false)}>{m['labels.accounts']()}</a
						>
					</li>
					<li>
						<a
							href="/settings/categories"
							aria-current={current('/settings/categories')}
							onclick={() => (drawerOpen = false)}>{m['labels.categories']()}</a
						>
					</li>
					<li>
						<a
							href="/settings/tags"
							aria-current={current('/settings/tags')}
							onclick={() => (drawerOpen = false)}>{m['labels.tags']()}</a
						>
					</li>
					<li>
						<a
							href="/settings/workspace"
							aria-current={current('/settings/workspace')}
							onclick={() => (drawerOpen = false)}>{m['workspace.label']()}</a
						>
					</li>
					<li>
						<a
							href="/settings/banks"
							aria-current={current('/settings/banks')}
							onclick={() => (drawerOpen = false)}>{m['bank.title']()}</a
						>
					</li>
					<li>
						<a
							href="/account"
							aria-current={current('/account')}
							onclick={() => (drawerOpen = false)}>{m['navigation.account_recovery']()}</a
						>
					</li>
					<li>
						<a href="/login" aria-current={current('/login')} onclick={() => (drawerOpen = false)}
							>{m['navigation.login']()}</a
						>
					</li>
				</Navigation>

				{#if bankSync.visible}
					<Button
						disabled={bankSync.disabled}
						onclick={() => {
							drawerOpen = false
							bankSync.sync()
						}}>{m['bank.sync']()}</Button
					>
				{/if}

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
											checked={selectedAccountIds === null ||
												selectedAccountIds.includes(account.id)}
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
					<a
						href="/accounts/new"
						aria-current={current('/accounts/new')}
						onclick={() => (drawerOpen = false)}>{m['actions.add_account']()}</a
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
			<div class="page-content">{@render children()}</div>
		</main>
	</div>
</div>

<style>
	.app-shell {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	:global(header.site-header) {
		inline-size: 100%;
		min-block-size: 3.5rem;
	}

	:global(header.site-header .navigation-toggle) {
		--dui-button-padding: 0;
		--dui-button-min-height: 2.75rem;
		inline-size: 2.75rem;
		block-size: 2.75rem;
		display: inline-grid;
		place-items: center;
	}

	:global(header.site-header .navigation-toggle [aria-hidden='true']) {
		inline-size: 1.5rem;
		block-size: 1.5rem;
		font-size: 1.5rem;
		line-height: 1;
		display: grid;
		place-items: center;
	}

	:global(aside.site-drawer) {
		flex: 0 0 var(--dui-drawer-width, 20rem);
	}

	:global(aside.site-drawer.inline-drawer) {
		block-size: calc(100vh - var(--dui-top-navigation-height, 3.5rem));
	}

	.workspace[data-drawer-open='false'] :global(aside.site-drawer) {
		flex-basis: 0;
	}

	.workspace[data-drawer-open='false'] :global(aside.site-drawer .inline-panel) {
		transform: translateX(-100%);
	}

	.workspace[data-drawer-open='true'] :global(aside.site-drawer .inline-panel) {
		transform: translateX(0);
	}

	:global(aside.site-drawer .inline-panel) {
		border: 0;
		border-inline-end: var(--dui-dialog-border-width, var(--dui-border-width, 2px)) solid
			var(--dui-dialog-border-color, var(--dui-color-foreground, currentColor));
	}

	.workspace {
		display: flex;
		align-items: flex-start;
		gap: var(--dui-space-sm, 1rem);
		min-block-size: 0;
		flex: 1;
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
		flex: 1 1 0%;
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
