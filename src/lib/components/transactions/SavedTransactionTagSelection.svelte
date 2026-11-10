<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
	import CatalogPager from '../navigation/CatalogPager.svelte'
	let {
		tags,
		page,
		disabled,
		onselect,
		onpage
	}: {
		tags: readonly { id: string; name: string; selected: boolean }[]
		page: { offset: number; total: number; hasMore: boolean }
		disabled: boolean
		onselect: (id: string, selected: boolean, form: HTMLFormElement | null) => void
		onpage: (offset: number) => void
	} = $props()
</script>

{#each tags as tag (tag.id)}
	<label
		><input
			type="checkbox"
			checked={tag.selected}
			{disabled}
			oninput={(event) => event.stopPropagation()}
			onchange={(event) => onselect(tag.id, event.currentTarget.checked, event.currentTarget.form)}
		/>{tag.name}</label
	>
{/each}
<CatalogPager {page} size={500} subject={m['nouns.tag']({ count: 2 })} {onpage} />
