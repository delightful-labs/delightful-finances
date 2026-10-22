<script lang="ts">
	import AppLink from '#lib/components/AppLink.svelte'
	import { page } from '$app/state'
	import { resolve } from '$app/paths'
	import { Text } from 'delightful-ui'
	import PageHeader from '#lib/components/PageHeader.svelte'
	import { m } from '#lib/paraglide/messages.js'

	const title = $derived(
		page.status === 404 ? m['errors.not_found_title']() : m['errors.unexpected_title']()
	)
</script>

<svelte:head>
	<title>{page.status} · {title} · {m['app.name']()}</title>
</svelte:head>

<main>
	<PageHeader title={`${page.status} · ${title}`} />
	<Text>
		{page.status === 404
			? m['errors.not_found_description']()
			: m['errors.unexpected_description']()}
	</Text>
	<Text><AppLink href={resolve('/')}>{m['errors.back_to_overview']()}</AppLink></Text>
</main>
