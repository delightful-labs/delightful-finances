<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { getReadiness } from '#lib/bank-sync.js'
	import JazzStartup from './JazzStartup.svelte'
	const readiness = getReadiness()
	const state = fromStore(readiness.snapshot)
</script>

<JazzStartup
	error={state.current.hasTag('startup-error')}
	onRetry={() => readiness.actor.send({ type: 'RETRY' })}
/>
