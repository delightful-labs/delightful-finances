<script lang="ts">
	import { Drawer } from 'delightful-ui'
	import type { Snippet } from 'svelte'
	import { m } from '#lib/paraglide/messages.js'
	let {
		drawerId,
		drawerOpen = $bindable(),
		children,
		footer
	}: {
		drawerId: string
		drawerOpen: boolean
		children: Snippet
		footer: Snippet
	} = $props()
</script>

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
		{@render children()}
		{@render footer()}
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
			--dui-details-content-padding: 0;
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
</style>
