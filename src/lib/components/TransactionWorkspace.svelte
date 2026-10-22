<script lang="ts">
	import AppLink from '#lib/components/AppLink.svelte'
	import { Button, Drawer, ScreenReaderText } from 'delightful-ui'
	import { onMount, type Snippet } from 'svelte'
	import { isMobile } from '#lib/viewport.js'
	import { m } from '#lib/paraglide/messages.js'
	import Icon from './AppIcon.svelte'
	import ListIcon from 'tdesign-icons-svg/src/view-list.svg?component'

	let {
		children,
		list,
		index,
		kind,
		listHref
	}: {
		children: Snippet
		list: Snippet<[boolean]>
		index: boolean
		kind: 'income' | 'expense'
		listHref?: string | undefined
	} = $props()
	let desktop = $state(false)
	let drawerOpen = $state(true)
	const drawerId = $props.id()
	onMount(() => {
		desktop = !isMobile()
	})
</script>

<svelte:window onresize={() => (desktop = !isMobile())} />

<div class="transaction-workspace" data-desktop={desktop}>
	<div class="transaction-content" class:index>
		{#if !desktop && listHref}
			<AppLink href={listHref}>{m['transactions.back_to_list']()}</AppLink>
		{/if}
		{#if desktop}
			<div class="drawer-toggle" hidden={drawerOpen}>
				<Button
					type="button"
					aria-controls={drawerId}
					aria-expanded={drawerOpen}
					onclick={() => (drawerOpen = true)}
				>
					<Icon icon={ListIcon} /><ScreenReaderText
						>{m['transactions.drawer.open']()}</ScreenReaderText
					>
				</Button>
			</div>
		{/if}
		{@render children()}
	</div>
	{#if desktop}
		<Drawer
			id={drawerId}
			side="right"
			heading={kind === 'income' ? m['labels.income']() : m['labels.expenses']()}
			closeLabel={m['transactions.drawer.close']()}
			bind:open={drawerOpen}
		>
			{@render list(false)}
		</Drawer>
	{:else if index}
		<div class="transaction-mobile-list">
			{@render list(true)}
		</div>
	{/if}
</div>

<style>
	.transaction-workspace {
		--dui-drawer-width: clamp(18rem, 35vw, 30rem);
		--dui-drawer-padding: var(--dui-spacing-xs);
		--dui-drawer-top: calc(var(--dui-top-navigation-height) + var(--dui-spacing-md));
		--dui-drawer-height: calc(
			100dvh - var(--dui-top-navigation-height) - 2 * var(--dui-spacing-md)
		);
		min-inline-size: 0;
	}

	.transaction-workspace[data-desktop='true'] {
		display: flex;
		align-items: flex-start;
		gap: var(--dui-spacing-md);
	}

	.transaction-content {
		view-transition-name: transaction-content;
		display: grid;
		align-content: start;
		gap: var(--dui-spacing-md);
		min-inline-size: 0;
		flex: 1 1 0%;
	}

	.transaction-workspace[data-desktop='false'] .transaction-content.index {
		display: none;
	}

	.transaction-mobile-list {
		view-transition-name: transaction-content;
	}

	.drawer-toggle[hidden] {
		display: none;
	}

	.drawer-toggle {
		display: flex;
		justify-content: flex-end;
	}
</style>
