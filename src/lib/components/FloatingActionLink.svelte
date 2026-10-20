<script lang="ts">
	import Icon from './AppIcon.svelte'
	import AddIcon from 'tdesign-icons-svg/src/add.svg?component'

	let { href, label }: { href: string; label: string } = $props()
</script>

<div class="floating-action-space">
	<a {href} aria-label={label} title={label}><Icon icon={AddIcon} /></a>
</div>

<style>
	.floating-action-space {
		min-block-size: 5rem;
	}

	a {
		position: fixed;
		inset-inline-end: calc(var(--dui-spacing-md) + env(safe-area-inset-right, 0px));
		inset-block-end: calc(var(--dui-spacing-md) + env(safe-area-inset-bottom, 0px));
		z-index: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 3.5rem;
		block-size: 3.5rem;
		border: var(--dui-border-width) solid var(--dui-color-foreground);
		border-radius: 50%;
		background-color: var(--dui-color-accent);
		color: var(--dui-color-on-accent);
		font-size: var(--dui-font-size-xxl);
		text-decoration: none;
		box-shadow: var(--dui-shadow);
	}

	a:hover {
		background-color: var(--dui-color-foreground);
		color: var(--dui-color-background);
	}
</style>
