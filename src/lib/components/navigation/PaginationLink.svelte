<script lang="ts">
	import { PaginationItem } from 'delightful-ui'
	import type { ComponentProps } from 'svelte'
	import AppLink from './AppLink.svelte'
	let { href, children, ...attributes }: ComponentProps<typeof PaginationItem> = $props()
</script>

<AppLink href={href ?? ''}>
	{#snippet render(destination)}
		<PaginationItem {...attributes} href={href === undefined ? undefined : destination}>
			{@render children?.()}
		</PaginationItem>
	{/snippet}
</AppLink>
