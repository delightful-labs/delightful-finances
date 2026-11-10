<script lang="ts">
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()

	import { getFinanceUiRuntime } from '#lib/runtime/finance-ui.js'
	import { fromStore } from 'svelte/store'
	import { page } from '$app/state'
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	import LoginForm from '#lib/components/identity/LoginForm.svelte'
	const runtime = getFinanceUiRuntime(),
		snapshot = fromStore(runtime.view)
	const recovery = $derived(snapshot.current?.recovery)
	function restoreAccount(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		const phrase = new FormData(event.currentTarget).get('recoveryPhrase')
		runtime.send({
			type: 'APPLICATION',
			command: {
				type: 'RECOVER',
				phrase: typeof phrase === 'string' ? phrase : '',
				origin: `${page.url.pathname}${page.url.search}${page.url.hash}`,
				destination: '/'
			}
		})
	}
</script>

<svelte:head
	><title
		>{m['actions.restore_subject']({ subject: m['nouns.account']({ count: 1 }) })} · {m[
			'app.name'
		]()}</title
	></svelte:head
>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader
			title={m['actions.restore_subject']({ subject: m['nouns.account']({ count: 1 }) })}
		/>{/snippet}

	{#if recovery}
		<LoginForm
			restoring={recovery.busy}
			navigationOnly={recovery.navigationOnly}
			restoreError={recovery.invalid}
			sessionError={recovery.failed || snapshot.current?.session.status === 'error'}
			navigationError={recovery.navigationFailed}
			canRetryNavigation={recovery.canRetryNavigation}
			draftRevision={recovery.draftRevision}
			onRetryNavigation={() =>
				runtime.send({ type: 'APPLICATION', command: { type: 'RETRY_NAVIGATION' } })}
			onsubmit={restoreAccount}
		/>
	{/if}
</PageLayout>
