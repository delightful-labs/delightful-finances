<script lang="ts">
	import AppLink from '#lib/components/AppLink.svelte'
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
		pathname.replace(/\/$/, '') === href.split(/[?#]/)[0]?.replace(/\/$/, '') ? 'page' : undefined
	)
</script>

<AppLink {href}>
	{#snippet render(destination)}
		<a class="navigation-link" href={destination} aria-current={current} {onclick}>
			<Icon navigation {icon} />{label}
		</a>
	{/snippet}
</AppLink>

<style>
	.navigation-link {
		font-family: var(--dui-font-family, 'Source Code Pro', monospace);
		padding-inline: 1rem;
	}

	.navigation-link[aria-current='page'] {
		background-color: var(--dui-color-accent, #94ff47);
		color: #000;
		text-decoration: none;
	}
</style>
