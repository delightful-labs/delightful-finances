<script lang="ts">
	import { setContext } from 'svelte'
	import { fromStore } from 'svelte/store'
	import { JazzSessionProvider } from 'jazz-tools/svelte'
	import { getReadiness } from '#lib/bank-sync.js'
	import {
		developerMenuKey,
		unavailableSampleControls,
		type DeveloperMenuContent
	} from '#lib/developer-menu.js'
	import DeveloperMenuDialog from './DeveloperMenuDialog.svelte'
	import SampleTransactionControls from './SampleTransactionControls.svelte'
	import SampleTransactions from './SampleTransactions.svelte'

	const controls = $state<DeveloperMenuContent>({
		income: unavailableSampleControls(),
		expense: unavailableSampleControls()
	})
	setContext(developerMenuKey, controls)
	const startup = fromStore(getReadiness().snapshot)
	const session = $derived(startup.current.context.session)
</script>

{#if import.meta.env.DEV}
	<DeveloperMenuDialog>
		<SampleTransactionControls kind="income" {...controls.income} />
		<SampleTransactionControls kind="expense" {...controls.expense} />
	</DeveloperMenuDialog>
	{#if session && !startup.current.hasTag('startup-error')}
		<JazzSessionProvider {session} autoAttachDevTools={false}>
			<SampleTransactions kind="income" />
			<SampleTransactions kind="expense" />
		</JazzSessionProvider>
	{/if}
{/if}
