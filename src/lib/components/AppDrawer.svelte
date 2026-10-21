<script lang="ts">
	import Icon from './AppIcon.svelte'
	import AppNavigationLink from './AppNavigationLink.svelte'
	import {
		Button,
		Drawer,
		Details,
		Navigation,
		Select,
		Checkbox,
		StatusMessage
	} from 'delightful-ui'
	import OverviewIcon from 'tdesign-icons-svg/src/dashboard.svg?component'
	import ExpensesIcon from 'tdesign-icons-svg/src/arrow-up.svg?component'
	import IncomeIcon from 'tdesign-icons-svg/src/arrow-down.svg?component'
	import AccountsIcon from 'tdesign-icons-svg/src/wallet.svg?component'
	import CategoriesIcon from 'tdesign-icons-svg/src/root-list.svg?component'
	import TagsIcon from 'tdesign-icons-svg/src/tag.svg?component'
	import WorkspaceIcon from 'tdesign-icons-svg/src/building.svg?component'
	import BanksIcon from 'tdesign-icons-svg/src/money.svg?component'
	import EditIcon from 'tdesign-icons-svg/src/edit.svg?component'
	import AccountIcon from 'tdesign-icons-svg/src/user.svg?component'
	import LoginIcon from 'tdesign-icons-svg/src/login.svg?component'
	import SettingsIcon from 'tdesign-icons-svg/src/setting.svg?component'
	import AddIcon from 'tdesign-icons-svg/src/add.svg?component'
	import SyncIcon from 'tdesign-icons-svg/src/refresh.svg?component'
	import { type ComponentProps, type Snippet } from 'svelte'
	import type { BankSyncControls } from '#lib/bank-sync.js'
	import type { Account, Organization } from '#lib/schema.js'
	import { m } from '#lib/paraglide/messages.js'
	import QueryContent from './QueryContent.svelte'
	import PwaUpdateIntegration from './PwaUpdateIntegration.svelte'

	let {
		drawerId,
		drawerOpen = $bindable(),
		pathname,
		onNavigate,
		accountCreation,
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
		onAllAccountsChange,
		editingAccountOrder,
		canToggleAccountOrder,
		canMoveAccount,
		onEditAccountOrder,
		onDoneAccountOrder,
		onMoveAccount
	}: {
		drawerId: string
		drawerOpen: boolean
		pathname: string
		onNavigate: () => void
		accountCreation: Snippet<[Snippet<[() => void, boolean]>]>
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
		editingAccountOrder: boolean
		canToggleAccountOrder: boolean
		canMoveAccount: (id: string, direction: 'up' | 'down') => boolean
		onEditAccountOrder: () => void
		onDoneAccountOrder: () => void
		onMoveAccount: (id: string, direction: 'up' | 'down') => void
	} = $props()
	const drawerInstanceId = $props.id()
	const filtersHeadingId = `${drawerInstanceId}-filters`
</script>

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
				<AppNavigationLink
					href="/"
					{pathname}
					icon={OverviewIcon}
					label={m['navigation.overview']()}
					onclick={onNavigate}
				/>
			</li>
			<li>
				<AppNavigationLink
					href="/expenses"
					{pathname}
					icon={ExpensesIcon}
					label={m['labels.expenses']()}
					onclick={onNavigate}
				/>
			</li>
			<li>
				<AppNavigationLink
					href="/income"
					{pathname}
					icon={IncomeIcon}
					label={m['labels.income']()}
					onclick={onNavigate}
				/>
			</li>

			<li>
				<AppNavigationLink
					href="/settings/categories"
					{pathname}
					icon={CategoriesIcon}
					label={m['labels.categories']()}
					onclick={onNavigate}
				/>
			</li>
			<li>
				<AppNavigationLink
					href="/settings/tags"
					{pathname}
					icon={TagsIcon}
					label={m['labels.tags']()}
					onclick={onNavigate}
				/>
			</li>
			<li>
				<Details caretPosition="right">
					{#snippet summary()}
						<span id={filtersHeadingId}
							><Icon class="menu-icon" icon={AccountsIcon} />{m['labels.accounts']()}</span
						>
					{/snippet}
					<div class="details-content-group">
						<section class="details-content-section" aria-labelledby={filtersHeadingId}>
							<QueryContent
								queries={accountQueries}
								loadingMessage={m['status.loading']({ subject: m['labels.accounts']() })}
								errorMessage={m['errors.load']({ subject: m['labels.accounts']() })}
							>
								{#if accounts.length > 0}
									<fieldset class="account-filters">
										<legend>{m['accounts.filters.legend']()}</legend>
										<ul>
											<li class="account-filter">
												<Checkbox
													name="accountIds"
													value="all"
													checked={selectedAccountIds === null ||
														accounts.every((account) => selectedAccountIds?.includes(account.id))}
													label={m['accounts.filters.all']()}
													onchange={(event) => onAllAccountsChange(event.currentTarget.checked)}
												/>
											</li>
											{#each accounts as account (account.id)}
												<li class="account-filter">
													<Checkbox
														name="accountIds"
														value={account.id}
														checked={selectedAccountIds === null ||
															selectedAccountIds.includes(account.id)}
														label={account.name}
														onchange={(event) =>
															onAccountChange(account.id, event.currentTarget.checked)}
													/>
													{#if editingAccountOrder}
														<span class="account-order-controls">
															<Button
																type="button"
																appearance="flat"
																disabled={!canMoveAccount(account.id, 'up')}
																aria-label={m['accounts.order.up']({ name: account.name })}
																onclick={() => onMoveAccount(account.id, 'up')}
																><Icon
																	icon={ExpensesIcon}
																	style="width: 1rem; height: 1rem;"
																/></Button
															>
															<Button
																type="button"
																appearance="flat"
																disabled={!canMoveAccount(account.id, 'down')}
																aria-label={m['accounts.order.down']({ name: account.name })}
																onclick={() => onMoveAccount(account.id, 'down')}
																><Icon
																	icon={IncomeIcon}
																	style="width: 1rem; height: 1rem;"
																/></Button
															>
														</span>
													{/if}
												</li>
											{/each}
										</ul>
									</fieldset>
									{#if canToggleAccountOrder}
										<Button
											type="button"
											appearance="flat"
											aria-pressed={editingAccountOrder}
											onclick={editingAccountOrder ? onDoneAccountOrder : onEditAccountOrder}
											>{editingAccountOrder
												? m['accounts.order.done']()
												: m['accounts.order.edit']()}</Button
										>
									{/if}
								{:else}
									<p>{m['actions.empty']({ name: m['labels.accounts']() })}</p>
								{/if}
							</QueryContent>
							{#snippet accountCreationTrigger(open: () => void, disabled: boolean)}
								<Button type="button" {disabled} onclick={open}>
									<Icon class="menu-icon" icon={AddIcon} />{m['actions.add']({
										name: m['labels.account']()
									})}
								</Button>
							{/snippet}
							{@render accountCreation(accountCreationTrigger)}
						</section>
					</div>
					<Navigation label={m['labels.accounts']()}>
						<li>
							<AppNavigationLink
								href="/accounts"
								{pathname}
								icon={EditIcon}
								label={m['accounts.manage']()}
								onclick={onNavigate}
							/>
						</li>
					</Navigation>
				</Details>
			</li>
			<li>
				<Details caretPosition="right">
					{#snippet summary()}
						<Icon class="menu-icon" icon={SettingsIcon} />{m['navigation.settings']()}
					{/snippet}
					<div class="details-content-group">
						<div class="details-content-section">
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
						</div>
					</div>
					<Navigation label={m['navigation.settings']()}>
						<li>
							<AppNavigationLink
								href="/settings/workspace"
								{pathname}
								icon={WorkspaceIcon}
								label={m['workspace.label']()}
								onclick={onNavigate}
							/>
						</li>
						<li>
							<AppNavigationLink
								href="/settings/banks"
								{pathname}
								icon={BanksIcon}
								label={m['bank.title']()}
								onclick={onNavigate}
							/>
						</li>
						<li>
							<AppNavigationLink
								href="/account"
								{pathname}
								icon={AccountIcon}
								label={m['navigation.account']()}
								onclick={onNavigate}
							/>
						</li>
					</Navigation>
				</Details>
			</li>
			<li>
				<AppNavigationLink
					href="/login"
					{pathname}
					icon={LoginIcon}
					label={m['navigation.login']()}
					onclick={onNavigate}
				/>
			</li>
		</Navigation>

		{#if bankSync.visible}
			<Button
				disabled={browserOffline || bankSync.disabled}
				aria-describedby={browserOffline ? 'sidebar-bank-sync-offline' : undefined}
				onclick={() => {
					onNavigate()
					bankSync.sync()
				}}><Icon class="menu-icon" icon={SyncIcon} />{m['bank.sync']()}</Button
			>
			{#if browserOffline}
				<p id="sidebar-bank-sync-offline">{m['bank.sync_offline']()}</p>
			{/if}
		{/if}

		<div class="sidebar-status">
			<PwaUpdateIntegration />
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

<style>
	:global(aside.site-drawer) {
		--dui-drawer-width: 20rem;
		--dui-drawer-padding: 0;
		--dui-navigation-gap: 0;
		--dui-details-border-width: 0px;
		--dui-details-content-border-width: 0px;
		--dui-details-summary-padding: 0.5rem 1rem;
		--dui-details-content-padding: 0;
		flex: 0 0 var(--dui-drawer-width, 20rem);
	}

	:global(aside.site-drawer.inline-drawer) {
		block-size: calc(100vh - var(--dui-top-navigation-height, 3.5rem));
	}

	:global(aside.site-drawer[data-open='false']) {
		flex-basis: 0;
	}

	:global(aside.site-drawer[data-open='false'] .inline-panel) {
		transform: translateX(-100%);
	}

	:global(aside.site-drawer[data-open='true'] .inline-panel) {
		transform: translateX(0);
	}

	:global(aside.site-drawer .inline-panel) {
		border: 0;
		border-inline-end: var(--dui-dialog-border-width, var(--dui-border-width, 2px)) solid
			var(--dui-dialog-border-color, var(--dui-color-foreground, currentColor));
	}

	.sidebar-content {
		display: flex;
		flex-direction: column;
		min-block-size: 100%;
	}

	.sidebar-content :global(.menu-icon) {
		inline-size: 1.25rem;
		block-size: 1.25rem;
		flex-shrink: 0;
		margin-inline-end: var(--dui-space-xs, 0.5rem);
		vertical-align: middle;
	}

	.sidebar-content :global(details > .details-content) {
		display: grid;
		gap: var(--dui-space-xs, 0.5rem);
	}

	.details-content-group {
		display: grid;
		gap: var(--dui-space-xs, 0.5rem);
		min-width: 0;
	}

	.details-content-section {
		display: grid;
		gap: var(--dui-space-xs, 0.5rem);
		min-width: 0;
		padding: var(--dui-space-xs, 0.5rem) 1rem 0;
	}

	.sidebar-status {
		margin-block-start: auto;
	}

	.details-content-section ul {
		list-style: none;
		margin: 0;
		padding: 0;
		gap: var(--dui-space-xs, 0.5rem);
	}

	p {
		margin: 0;
	}

	.account-filters {
		margin: 0;
		padding: 0;
		border: 0;
		min-inline-size: 0;
	}

	.account-filters legend {
		font-size: var(--dui-font-size-sm, 0.875rem);
	}

	.account-filter {
		display: flex;
		align-items: center;
		gap: var(--dui-space-xs, 0.5rem);
	}

	.account-order-controls {
		margin-inline-start: auto;
		display: flex;
	}

	@media (max-width: 48rem) {
		:global(aside.site-drawer) {
			--dui-drawer-width: calc(100% - 3.5rem);
		}
	}
</style>
