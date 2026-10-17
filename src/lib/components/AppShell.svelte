<script lang="ts">
	import PageContent from './PageContent.svelte'
	import AppTopMenu from './AppTopMenu.svelte'
	import AppDrawer from './AppDrawer.svelte'
	import type QueryContent from './QueryContent.svelte'
	import { onMount, type ComponentProps, type Snippet } from 'svelte'
	import { page } from '$app/state'
	import { isMobile } from '#lib/viewport.js'
	import type { BankSyncControls } from '#lib/bank-sync.js'
	import type { Account, Organization } from '#lib/schema.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		children,
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
		onEditAccountOrder,
		onDoneAccountOrder,
		onMoveAccount
	}: {
		children: Snippet
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
		onEditAccountOrder: () => void
		onDoneAccountOrder: () => void
		onMoveAccount: (id: string, direction: 'up' | 'down') => void
	} = $props()
	const shellId = $props.id()
	const drawerId = `${shellId}-navigation`
	const toggleId = `${shellId}-toggle`
	let drawerOpen = $state(false)
	let mobileViewport = $state(false)
	const mainInert = $derived(mobileViewport && drawerOpen)
	let topNavigationHeight = $state(44)

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
</script>

<svelte:window onresize={() => (mobileViewport = isMobile())} />

<div class="app-shell" style="--dui-top-navigation-height: {topNavigationHeight}px">
	<AppTopMenu {drawerId} {toggleId} {drawerOpen} onToggle={() => (drawerOpen = !drawerOpen)} />
	<div class="workspace" data-drawer-open={drawerOpen}>
		<AppDrawer
			{drawerId}
			bind:drawerOpen
			pathname={page.url.pathname}
			onNavigate={dismissMobileDrawer}
			{accountCreation}
			{bankSync}
			{syncConfigured}
			{browserOffline}
			{organizations}
			{accounts}
			{organizationId}
			{selectedAccountIds}
			{organizationQueries}
			{accountQueries}
			{onOrganizationChange}
			{onAccountChange}
			{onAllAccountsChange}
			{editingAccountOrder}
			{onEditAccountOrder}
			{onDoneAccountOrder}
			{onMoveAccount}
		/>
		<main inert={mainInert}>
			<PageContent>{@render children()}</PageContent>
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

	.workspace {
		display: flex;
		align-items: flex-start;
		gap: var(--dui-space-sm, 1rem);
		min-block-size: 0;
		flex: 1;
	}

	main {
		display: grid;
		align-content: start;
		flex: 1 1 0%;
		min-width: 0;
		padding: var(--dui-space-sm, 1rem);
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

		main {
			box-sizing: border-box;
			flex: 0 0 100%;
		}
	}
</style>
