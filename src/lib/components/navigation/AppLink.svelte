<script lang="ts">
	import { getContext, type Snippet } from 'svelte'
	import type { HTMLAnchorAttributes } from 'svelte/elements'
	import { queryLinksKey, type QueryLinkContext } from '#lib/filters/query-links.js'
	import { inheritedQueryHref, type QueryUpdates } from '#lib/domain/query-params.js'
	import Anchor from './Anchor.svelte'

	const context = getContext<QueryLinkContext | undefined>(queryLinksKey)
	let {
		href,
		query = {},
		inheritParams,
		render,
		children,
		...attributes
	}: Omit<HTMLAnchorAttributes, 'href' | 'children'> & {
		href: string
		query?: QueryUpdates
		inheritParams?: readonly string[] | false
		render?: Snippet<[string]>
		children?: Snippet
	} = $props()
	const keys = $derived(
		inheritParams === false || (attributes.download != null && attributes.download !== false)
			? []
			: (inheritParams ?? context?.keys ?? [])
	)
	const destination = $derived(inheritedQueryHref(href, context?.href, keys, query))
</script>

{#if render}
	{@render render(destination)}
{:else}
	<Anchor {...attributes} href={destination}>{@render children?.()}</Anchor>
{/if}
