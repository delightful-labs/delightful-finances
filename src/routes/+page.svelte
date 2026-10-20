<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/PageHeader.svelte'
</script>

<svelte:head>
	<title>{m['navigation.overview']()} · {m['app.name']()}</title>
</svelte:head>

<PageHeader title={m['navigation.overview']()} />

<nav aria-label={m['navigation.label']()}>
	<ul>
		<li><a href="/expenses">{m['labels.expenses']()}</a></li>
		<li><a href="/income">{m['labels.income']()}</a></li>
	</ul>
</nav>
