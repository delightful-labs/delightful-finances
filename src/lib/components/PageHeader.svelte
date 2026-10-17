<script lang="ts">
	import { Heading, Text } from 'delightful-ui'

	let { title, action }: { title: string; action?: { href: string; label: string } } = $props()
</script>

<Heading level="h1">{title}</Heading>
{#if action}<Text><a href={action.href}>{action.label}</a></Text>{/if}
