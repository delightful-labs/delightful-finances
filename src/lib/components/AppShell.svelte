<script lang="ts">
	import Icon from './AppIcon.svelte'
	import {
		Button,
		Drawer,
		Details,
		Navigation,
		Select,
		Checkbox,
		StatusMessage,
		TopNavigation,
		ScreenReaderText
	} from 'delightful-ui'
	import MenuIcon from 'tdesign-icons-svg/src/menu-fold.svg?component'
	import CloseIcon from 'tdesign-icons-svg/src/close.svg?component'
	import OverviewIcon from 'tdesign-icons-svg/src/dashboard.svg?component'
	import ExpensesIcon from 'tdesign-icons-svg/src/arrow-up.svg?component'
	import IncomeIcon from 'tdesign-icons-svg/src/arrow-down.svg?component'
	import AccountsIcon from 'tdesign-icons-svg/src/wallet.svg?component'
	import CategoriesIcon from 'tdesign-icons-svg/src/root-list.svg?component'
	import TagsIcon from 'tdesign-icons-svg/src/tag.svg?component'
	import WorkspaceIcon from 'tdesign-icons-svg/src/building.svg?component'
	import BanksIcon from 'tdesign-icons-svg/src/money.svg?component'
	import AccountIcon from 'tdesign-icons-svg/src/user.svg?component'
	import LoginIcon from 'tdesign-icons-svg/src/login.svg?component'
	import SettingsIcon from 'tdesign-icons-svg/src/setting.svg?component'
	import AddIcon from 'tdesign-icons-svg/src/add.svg?component'
	import SyncIcon from 'tdesign-icons-svg/src/refresh.svg?component'
	import { onMount, type ComponentProps, type Snippet } from 'svelte'
	import { page } from '$app/state'
	import { isMobile } from '#lib/viewport.js'
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
	let mobileViewport = $state(false)
	const mainInert = $derived(mobileViewport && drawerOpen)
	let topNavigationHeight = $state(56)

	onMount(() => {
		mobileViewport = isMobile()
		drawerOpen = !mobileViewport

		const resizeObserver = new ResizeObserver(([entry]) => {
			if (!entry) return
			const borderBox = entry.borderBoxSize[0]
			topNavigationHeight = borderBox?.blockSize ?? entry.contentRect.height
		})
		const siteHeader = document.querySelector<HTMLElement>('[data-top-navigation-root]')
		if (siteHeader) resizeObserver.observe(siteHeader)
		return () => resizeObserver.disconnect()
	})

	function dismissMobileDrawer() {
		if (isMobile()) drawerOpen = false
	}

	function current(href: string) {
		return page.url.pathname.replace(/\/$/, '') === href.replace(/\/$/, '') ? 'page' : undefined
	}
</script>

<svelte:window onresize={() => (mobileViewport = isMobile())} />

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
			{#if drawerOpen}
				<Icon style="width: 1.5rem; height: 1.5rem;" icon={CloseIcon} />
			{:else}
				<Icon style="width: 1.5rem; height: 1.5rem;" icon={MenuIcon} />
			{/if}
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
			style="--dui-drawer-height: calc(100vh - var(--dui-top-navigation-height)); --dui-drawer-top: var(--dui-top-navigation-height)"
			bind:open={drawerOpen}
		>
			<div class="sidebar-content">
				<Navigation label={m['navigation.label']()}>
					<li>
						<a href="/" aria-current={current('/')} onclick={dismissMobileDrawer}
							><Icon class="menu-icon" icon={OverviewIcon} />{m['navigation.overview']()}</a
						>
					</li>
					<li>
						<a href="/expenses" aria-current={current('/expenses')} onclick={dismissMobileDrawer}
							><Icon class="menu-icon" icon={ExpensesIcon} />{m['labels.expenses']()}</a
						>
					</li>
					<li>
						<a href="/incomes" aria-current={current('/incomes')} onclick={dismissMobileDrawer}
							><Icon class="menu-icon" icon={IncomeIcon} />{m['labels.income']()}</a
						>
					</li>

					<li>
						<a
							href="/settings/categories"
							aria-current={current('/settings/categories')}
							onclick={dismissMobileDrawer}
							><Icon class="menu-icon" icon={CategoriesIcon} />{m['labels.categories']()}</a
						>
					</li>
					<li>
						<a
							href="/settings/tags"
							aria-current={current('/settings/tags')}
							onclick={dismissMobileDrawer}
							><Icon class="menu-icon" icon={TagsIcon} />{m['labels.tags']()}</a
						>
					</li>
					<li>
						<Details>
							{#snippet summary()}
								<span id={filtersHeadingId}
									><Icon class="menu-icon" icon={AccountsIcon} />{m['labels.accounts']()}</span
								>
							{/snippet}
							<Navigation label={m['labels.accounts']()}>
								<li>
									<a
										href="/accounts"
										aria-current={current('/accounts')}
										onclick={dismissMobileDrawer}
										><Icon class="menu-icon" icon={AccountsIcon} />{m['labels.accounts']()}</a
									>
								</li>
							</Navigation>
							<section aria-labelledby={filtersHeadingId}>
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
														onchange={(event) =>
															onAccountChange(account.id, event.currentTarget.checked)}
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
									onclick={dismissMobileDrawer}
									><Icon class="menu-icon" icon={AddIcon} />{m['actions.add_account']()}</a
								>
							</section>
						</Details>
					</li>
					<li>
						<Details>
							{#snippet summary()}
								<Icon class="menu-icon" icon={SettingsIcon} />{m['navigation.settings']()}
							{/snippet}
							<QueryContent
								queries={organizationQueries}
								loadingMessage={m['status.loading']({ subject: m['labels.workspaces']() })}
								errorMessage={m['errors.load']({ subject: m['labels.workspaces']() })}
							>
								<Select
									label={m['workspace.current']()}
									id="active-organization"
									value={organizationId ?? ''}
									onchange={(event) => onOrganizationChange(event.currentTarget.value)}
								>
									{#each organizations as organization (organization.id)}
										<option value={organization.id}>{organization.name}</option>
									{/each}
								</Select>
							</QueryContent>
							<Navigation label={m['navigation.settings']()}>
								<li>
									<a
										href="/settings/workspace"
										aria-current={current('/settings/workspace')}
										onclick={dismissMobileDrawer}
										><Icon class="menu-icon" icon={WorkspaceIcon} />{m['workspace.label']()}</a
									>
								</li>
								<li>
									<a
										href="/settings/banks"
										aria-current={current('/settings/banks')}
										onclick={dismissMobileDrawer}
										><Icon class="menu-icon" icon={BanksIcon} />{m['bank.title']()}</a
									>
								</li>
								<li>
									<a
										href="/account"
										aria-current={current('/account')}
										onclick={dismissMobileDrawer}
										><Icon class="menu-icon" icon={AccountIcon} />{m['navigation.account']()}</a
									>
								</li>
							</Navigation>
						</Details>
					</li>
					<li>
						<a href="/login" aria-current={current('/login')} onclick={dismissMobileDrawer}
							><Icon class="menu-icon" icon={LoginIcon} />{m['navigation.login']()}</a
						>
					</li>
				</Navigation>

				{#if bankSync.visible}
					<Button
						disabled={bankSync.disabled}
						onclick={() => {
							dismissMobileDrawer()
							bankSync.sync()
						}}><Icon class="menu-icon" icon={SyncIcon} />{m['bank.sync']()}</Button
					>
				{/if}

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
		<main inert={mainInert}>
			<div class="page-content">{@render children()}</div>
		</main>
		{#if mainInert}
			<button
				class="drawer-dismiss"
				type="button"
				aria-label={m['navigation.close']()}
				onclick={() => {
					drawerOpen = false
					document.getElementById(toggleId)?.focus()
				}}
			></button>
		{/if}
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

	:global(aside.site-drawer) {
		--dui-drawer-width: 20rem;
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

	.sidebar-content :global(.menu-icon) {
		inline-size: 1.25rem;
		block-size: 1.25rem;
		flex-shrink: 0;
		margin-inline-end: var(--dui-space-xs, 0.5rem);
		vertical-align: middle;
	}

	.sidebar-content :global(a[aria-current='page']) {
		background-color: var(--dui-color-accent, #94ff47);
		color: #000;
		text-decoration: none;
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

	.drawer-dismiss {
		position: absolute;
		inset-block: 0;
		inset-inline-end: 0;
		inline-size: 3.5rem;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}

	@media (max-width: 48rem) {
		.app-shell {
			inline-size: 100%;
			min-inline-size: 0;
			overflow-x: clip;
		}

		.workspace {
			position: relative;
			gap: 0;
			inline-size: 100%;
			min-inline-size: 0;
			overflow-x: clip;
		}

		:global(aside.site-drawer) {
			--dui-drawer-width: calc(100% - 3.5rem);
		}

		main {
			box-sizing: border-box;
			flex: 0 0 100%;
		}
	}
</style>
