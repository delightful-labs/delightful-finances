<script lang="ts">
	import 'delightful-ui/theme.css'
	import { PUBLIC_JAZZ_APP_ID, PUBLIC_JAZZ_SERVER_URL } from '$app/env/public'
	import { onMount, setContext, type Snippet } from 'svelte'
	import { useMachine } from '@xstate/svelte'
	import { fromStore } from 'svelte/store'
	import { createSessionStartupMachine } from '#lib/machines/session-startup.js'
	import { JazzSessionProvider, type JazzSessionConfig } from 'jazz-tools/svelte'
	import JazzStartup from '#lib/components/JazzStartup.svelte'
	import SessionStartup from '#lib/components/SessionStartup.svelte'
	import WorkspaceBootstrap from '#lib/components/WorkspaceBootstrap.svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { getCurrentJazzSession, getOrCreateJazzSession } from '#lib/jazz-session.js'

	let { children }: { children: Snippet } = $props()
	const financeFilters = $state<FinanceFilters>({
		activeOrganizationId: null,
		selectedAccountIds: null
	})

	setContext(financeFiltersKey, financeFilters)

	const jazzConfig = {
		appId: PUBLIC_JAZZ_APP_ID,
		serverUrl: PUBLIC_JAZZ_SERVER_URL,
		initial: 'local-first'
	} satisfies JazzSessionConfig

	const { snapshot, send } = useMachine(
		createSessionStartupMachine(() => getOrCreateJazzSession(jazzConfig), getCurrentJazzSession())
	)
	const startupState = fromStore(snapshot)
	const jazzSession = $derived(startupState.current.context.result)

	onMount(() => send({ type: 'START' }))
</script>

{#snippet startup()}
	<SessionStartup />
{/snippet}

{#if jazzSession}
	<JazzSessionProvider session={jazzSession} fallback={startup}>
		<WorkspaceBootstrap>{@render children()}</WorkspaceBootstrap>
	</JazzSessionProvider>
{:else}
	<JazzStartup
		error={startupState.current.matches('error')}
		onRetry={() => send({ type: 'RETRY' })}
	/>
{/if}
