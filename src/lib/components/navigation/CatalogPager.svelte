<script lang="ts">
	import { Button } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	let {
		page,
		size,
		subject,
		onpage
	}: {
		page: { offset: number; hasMore: boolean }
		size: number
		subject: string
		onpage: (offset: number) => void
	} = $props()
</script>

{#if page.offset > 0 || page.hasMore}
	<nav aria-label={subject}>
		<Button
			type="button"
			disabled={page.offset === 0}
			onclick={() => onpage(Math.max(0, page.offset - size))}
			>{m['labels.previous_subject']({ subject })}</Button
		>
		<Button type="button" disabled={!page.hasMore} onclick={() => onpage(page.offset + size)}
			>{m['labels.next_subject']({ subject })}</Button
		>
	</nav>
{/if}
