<script lang="ts">
	import type { ComponentProps } from 'svelte'
	import Icon from './AppIcon.svelte'

	let {
		href,
		pathname,
		icon,
		label,
		onclick
	}: {
		href: string
		pathname: string
		icon: ComponentProps<typeof Icon>['icon']
		label: string
		onclick: () => void
	} = $props()

	const current = $derived(
		pathname.replace(/\/$/, '') === href.replace(/\/$/, '') ? 'page' : undefined
	)
</script>

<a class="navigation-link" {href} aria-current={current} {onclick}>
	<Icon class="navigation-link-icon" {icon} />{label}
</a>

<style>
	a.navigation-link {
		padding-inline: 1rem;
	}

	a.navigation-link[aria-current='page'] {
		background-color: var(--dui-color-accent, #94ff47);
		color: #000;
		text-decoration: none;
	}

	.navigation-link :global(.navigation-link-icon) {
		inline-size: 1.25rem;
		block-size: 1.25rem;
		flex-shrink: 0;
		margin-inline-end: var(--dui-space-xs, 0.5rem);
		vertical-align: middle;
	}
</style>
