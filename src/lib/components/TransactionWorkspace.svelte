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
		heading,
		listHref
	}: {
		children: Snippet
		list: Snippet<[boolean]>
		index: boolean
		heading: string
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
	<div class="transaction-content" hidden={!desktop && index}>
		{#if !desktop && listHref}
			<AppLink href={listHref}
				>{m['actions.back_to_subject']({ subject: m['nouns.list']({ count: 1 }) })}</AppLink
			>
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
						>{m['actions.open_subject']({
							subject: m['nouns.transaction']({ count: 2 })
						})}</ScreenReaderText
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
			{heading}
			closeLabel={m['actions.close_subject']({
				subject: m['nouns.transaction']({ count: 2 })
			})}
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
		min-inline-size: 0;
		height: 100%;
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

	.transaction-mobile-list {
		view-transition-name: transaction-content;
	}

	.drawer-toggle {
		display: flex;
		justify-content: flex-end;
	}

	[hidden] {
		display: none;
	}
</style>
