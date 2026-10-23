<script lang="ts">
	import AppLink from '#lib/components/AppLink.svelte'
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/PageHeader.svelte'
</script>

<svelte:head>
	<title>{m['navigation.overview']()} · {m['app.name']()}</title>
</svelte:head>

<PageHeader title={m['navigation.overview']()} />

<nav aria-label={m['navigation.label']()}>
	<ul>
		<li>
			<AppLink href="/expenses">{m['nouns.expense']({ count: 2 })}</AppLink>
		</li>
		<li>
			<AppLink href="/income">{m['nouns.income']({ count: 1 })}</AppLink>
		</li>
	</ul>
</nav>
