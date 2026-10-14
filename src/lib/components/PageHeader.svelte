<script lang="ts">
	let { title, action }: { title: string; action?: { href: string; label: string } } = $props()
</script>

<h1>{title}</h1>
{#if action}<p><a href={action.href}>{action.label}</a></p>{/if}

<style>
	p {
		margin-block: 0.25rem;
	}
</style>
