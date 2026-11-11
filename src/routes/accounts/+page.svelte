<script lang="ts">
	import WorkerAccounts from '#lib/components/accounts/WorkerAccounts.svelte'
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	import { m } from '#lib/paraglide/messages.js'
	const navigation = getPageNavigation()
</script>

<PageLayout {navigation}
	>{#snippet pageHeading()}<PageHeader
			title={m['nouns.account']({ count: 2 })}
		/>{/snippet}<WorkerAccounts /></PageLayout
>
