<script lang="ts">
	import { INCOME, EXPENSE } from '#lib/domain/transaction-kind.js'
	import { onMount, setContext } from 'svelte'
	import { fromStore } from 'svelte/store'
	import { JazzSessionProvider, type JazzClient, type JazzSession } from 'jazz-tools/svelte'
	import { getReadiness } from '#lib/bank-sync.js'
	import {
		developerMenuKey,
		unavailableSampleControls,
		type DeveloperMenuContent
	} from '#lib/developer-menu.js'
	import DeveloperMenuDialog from './DeveloperMenuDialog.svelte'
	import SampleTransactionControls from './SampleTransactionControls.svelte'
	import SampleTransactions from './SampleTransactions.svelte'

	let { appId, serverUrl }: { appId: string; serverUrl: string } = $props()
	let browserOrigin = $state<string>()
	let sessionSnapshot = $state<ReturnType<JazzSession<JazzClient>['getSnapshot']>>()
	onMount(() => {
		browserOrigin = window.location.origin
	})

	const controls = $state<DeveloperMenuContent>({
		income: unavailableSampleControls(),
		expense: unavailableSampleControls()
	})
	setContext(developerMenuKey, controls)
	const startup = fromStore(getReadiness().snapshot)
	const session = $derived(startup.current.context.session)
	$effect(() => {
		const current = session
		sessionSnapshot = current?.getSnapshot()
		return current?.subscribe(() => {
			sessionSnapshot = current.getSnapshot()
		})
	})
</script>

{#if import.meta.env.DEV}
	<DeveloperMenuDialog {appId} {serverUrl} {browserOrigin} accountId={sessionSnapshot?.account?.id}>
		<SampleTransactionControls kind={INCOME} {...controls.income} />
		<SampleTransactionControls kind={EXPENSE} {...controls.expense} />
	</DeveloperMenuDialog>
	{#if session && !startup.current.hasTag('startup-error')}
		<JazzSessionProvider {session} autoAttachDevTools={false}>
			<SampleTransactions kind={INCOME} />
			<SampleTransactions kind={EXPENSE} />
		</JazzSessionProvider>
	{/if}
{/if}
