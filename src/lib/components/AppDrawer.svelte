<script lang="ts">
	import { INCOME_PATH, EXPENSES_PATH } from '#lib/domain/transaction-kind.js'
	import Icon from './AppIcon.svelte'
	import AppNavigationLink from './AppNavigationLink.svelte'
	import AppDrawerContentSection from './AppDrawerContentSection.svelte'
	import { Button, Drawer, Details, Navigation, Checkbox, StatusMessage } from 'delightful-ui'
	import OverviewIcon from 'tdesign-icons-svg/src/dashboard.svg?component'
	import ExpensesIcon from 'tdesign-icons-svg/src/arrow-up.svg?component'
	import IncomeIcon from 'tdesign-icons-svg/src/arrow-down.svg?component'
	import TransfersIcon from 'tdesign-icons-svg/src/swap.svg?component'
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
	import WorkspaceSelector from './WorkspaceSelector.svelte'
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

{#snippet accountCreationTrigger(open: () => void, disabled: boolean)}
	<Button type="button" {disabled} onclick={open}>
		<Icon navigation icon={AddIcon} />{m['actions.add_subject']({
			subject: m['nouns.account']({ count: 1 })
		})}
	</Button>
{/snippet}

<Drawer
	class="site-drawer"
	id={drawerId}
	heading={m['navigation.label']()}
	headingHidden
	closeLabel={m['actions.close_subject']({ subject: m['navigation.label']() })}
	showCloseButton={false}
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
					href={EXPENSES_PATH}
					{pathname}
					icon={ExpensesIcon}
					label={m['nouns.expense']({ count: 2 })}
					onclick={onNavigate}
				/>
			</li>
			<li>
				<AppNavigationLink
					href={INCOME_PATH}
					{pathname}
					icon={IncomeIcon}
					label={m['nouns.income']({ count: 1 })}
					onclick={onNavigate}
				/>
			</li>
			<li>
				<AppNavigationLink
					href="/transfers/new"
					{pathname}
					icon={TransfersIcon}
					label={m['nouns.transfer']({ count: 2 })}
					onclick={onNavigate}
				/>
			</li>

			<li>
				<AppNavigationLink
					href="/settings/categories"
					{pathname}
					icon={CategoriesIcon}
					label={m['nouns.category']({ count: 2 })}
					onclick={onNavigate}
				/>
			</li>
			<li>
				<AppNavigationLink
					href="/settings/tags"
					{pathname}
					icon={TagsIcon}
					label={m['nouns.tag']({ count: 2 })}
					onclick={onNavigate}
				/>
			</li>
			<li>
				<Details caretPosition="right">
					{#snippet summary()}
						<span id={filtersHeadingId}
							><Icon navigation icon={AccountsIcon} />{m['nouns.account']({
								count: 2
							})}</span
						>
					{/snippet}
					{#snippet children()}
						<div class="disclosure-content">
							<AppDrawerContentSection element="section" aria-labelledby={filtersHeadingId}>
								<QueryContent
									queries={accountQueries}
									loadingMessage={m['status.loading_subject']({
										subject: m['nouns.account']({ count: 2 })
									})}
									errorMessage={m['errors.load_subject']({
										subject: m['nouns.account']({ count: 2 })
									})}
								>
									{#if accounts.length > 0}
										<fieldset class="account-filters">
											<legend
												>{m['actions.filter_subject']({
													subject: m['nouns.account']({ count: 2 })
												})}</legend
											>
											<ul>
												<li class="account-filter">
													<Checkbox
														name="accountIds"
														value="all"
														checked={selectedAccountIds === null ||
															accounts.every((account) => selectedAccountIds?.includes(account.id))}
														label={m['labels.all_subjects']({
															subjects: m['nouns.account']({ count: 2 })
														})}
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
																	aria-label={m['actions.move_up_name']({ name: account.name })}
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
																	aria-label={m['actions.move_down_name']({ name: account.name })}
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
													? m['actions.done']()
													: m['actions.edit_subject']({
															subject: m['nouns.order']({ count: 1 })
														})}</Button
											>
										{/if}
									{:else}
										<p>
											{m['labels.no_subjects_yet']({ subjects: m['nouns.account']({ count: 2 }) })}
										</p>
									{/if}
								</QueryContent>

								{@render accountCreation(accountCreationTrigger)}
							</AppDrawerContentSection>
							<Navigation label={m['nouns.account']({ count: 2 })}>
								<li>
									<AppNavigationLink
										href="/accounts"
										{pathname}
										icon={EditIcon}
										label={m['actions.manage_subject']({
											subject: m['nouns.account']({ count: 2 })
										})}
										onclick={onNavigate}
									/>
								</li>
							</Navigation>
						</div>
					{/snippet}
				</Details>
			</li>
			<li>
				<Details caretPosition="right">
					{#snippet summary()}
						<Icon navigation icon={SettingsIcon} />{m['navigation.settings']()}
					{/snippet}
					{#snippet children()}
						<div class="disclosure-content">
							<AppDrawerContentSection>
								<QueryContent
									queries={organizationQueries}
									loadingMessage={m['status.loading_subject']({
										subject: m['nouns.workspace']({ count: 2 })
									})}
									errorMessage={m['errors.load_subject']({
										subject: m['nouns.workspace']({ count: 2 })
									})}
								>
									<WorkspaceSelector
										{organizations}
										{organizationId}
										onchange={onOrganizationChange}
									/>
								</QueryContent>
							</AppDrawerContentSection>
							<Navigation label={m['navigation.settings']()}>
								<li>
									<AppNavigationLink
										href="/settings/workspace"
										{pathname}
										icon={WorkspaceIcon}
										label={m['nouns.workspace']({ count: 2 })}
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
										label={m['nouns.account']({ count: 1 })}
										onclick={onNavigate}
									/>
								</li>
							</Navigation>
						</div>
					{/snippet}
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

		<AppDrawerContentSection>
			{#if bankSync.visible}
				<Button
					disabled={browserOffline || bankSync.disabled}
					aria-describedby={browserOffline ? 'sidebar-bank-sync-offline' : undefined}
					onclick={() => {
						onNavigate()
						bankSync.sync()
					}}><Icon navigation icon={SyncIcon} />{m['bank.sync']()}</Button
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
		</AppDrawerContentSection>
	</div>
</Drawer>

<style>
	:global {
		.site-drawer {
			--dui-drawer-width: 20rem;
			--dui-drawer-padding: 0;
			--dui-drawer-panel-border-inline-end: var(
					--dui-dialog-border-width,
					var(--dui-border-width, 2px)
				)
				solid var(--dui-dialog-border-color, var(--dui-color-foreground, currentColor));
			--dui-navigation-gap: 0;
			--dui-details-border-width: 0px;
			--dui-details-summary-padding: 0.5rem 1rem;
		}

		@media (max-width: 48rem) {
			.site-drawer {
				--dui-drawer-width: calc(100% - 3.5rem);
			}
		}
	}

	.sidebar-content {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		height: 100%;
	}

	.disclosure-content {
		display: grid;
		gap: var(--dui-space-xs, 0.5rem);
		min-inline-size: 0;
	}

	.sidebar-status {
		margin-block-start: auto;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
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

	legend {
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
</style>
