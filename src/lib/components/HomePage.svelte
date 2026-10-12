<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
</script>

<svelte:head>
	<title>{m['navigation.overview']()} · {m['app.name']()}</title>
</svelte:head>

<h1>{m['navigation.overview']()}</h1>

<nav aria-label={m['navigation.label']()}>
	<ul>
		<li><a href="/expenses">{m['labels.expenses']()}</a></li>
		<li><a href="/incomes">{m['labels.income']()}</a></li>
	</ul>
</nav>
