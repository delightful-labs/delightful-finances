<script lang="ts">
	import { getJazzSession } from 'jazz-tools/svelte'
	import { useMachine } from '@xstate/svelte'
	import { fromStore } from 'svelte/store'
	import { createSessionStartupMachine } from '#lib/machines/session-startup.js'
	import JazzStartup from './JazzStartup.svelte'

	const session = getJazzSession()
	const observedSession = fromStore(session)
	// Retry reopens the SDK-selected identity; the machine does not select accounts.
	const { snapshot, send } = useMachine(createSessionStartupMachine(() => session.retry()))
	const startupState = fromStore(snapshot)

	$effect(() => {
		const current = observedSession.current
		if (current.status === 'error' || current.error) send({ type: 'SESSION_FAILED' })
		else if (current.status === 'ready') send({ type: 'SESSION_READY' })
	})
</script>

<JazzStartup
	error={startupState.current.matches('error')}
	onRetry={() => send({ type: 'RETRY' })}
/>
