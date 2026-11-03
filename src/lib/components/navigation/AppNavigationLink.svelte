<script lang="ts">
	import AppLink from '#lib/components/navigation/AppLink.svelte'
	import type { ComponentProps } from 'svelte'
	import { NavigationLink } from 'delightful-ui'

	let {
		href,
		pathname,
		icon,
		label,
		onclick
	}: {
		href: string
		pathname: string
		icon: ComponentProps<typeof NavigationLink>['icon']
		label: string
		onclick: () => void
	} = $props()

	const current = $derived(
		pathname.replace(/\/$/, '') === href.split(/[?#]/)[0]?.replace(/\/$/, '') ? 'page' : undefined
	)
</script>

<AppLink {href}>
	{#snippet render(destination)}
		<NavigationLink href={destination} aria-current={current} {icon} {onclick}>
			{label}
		</NavigationLink>
	{/snippet}
</AppLink>
