<script lang="ts">
	import { FloatingAction } from 'delightful-ui'
	import AppLink from '#lib/components/navigation/AppLink.svelte'
	import AddIcon from 'tdesign-icons-svg/src/add.svg?component'

	let { href, label }: { href: string; label: string } = $props()
</script>

<AppLink {href}>
	{#snippet render(destination)}
		<FloatingAction href={destination} {label} icon={AddIcon} class="floating-action-link" />
	{/snippet}
</AppLink>
