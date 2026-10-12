<script lang="ts">
	import { PUBLIC_JAZZ_APP_ID, PUBLIC_JAZZ_SERVER_URL } from '$app/env/public'
	import { onMount, setContext, type Snippet } from 'svelte'
	import {
		JazzSessionProvider,
		type JazzClient,
		type JazzSession,
		type JazzSessionConfig
	} from 'jazz-tools/svelte'
	import JazzStartup from '#lib/components/JazzStartup.svelte'
	import WorkspaceBootstrap from '#lib/components/WorkspaceBootstrap.svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { getCurrentJazzSession, getOrCreateJazzSession } from '#lib/jazz-session.js'

	let { children }: { children: Snippet } = $props()
	let jazzSession = $state.raw<JazzSession<JazzClient> | undefined>(getCurrentJazzSession())
	let sessionError = $state(false)
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

	onMount(() => {
		void getOrCreateJazzSession(jazzConfig)
			.then((session) => (jazzSession = session))
			.catch(() => (sessionError = true))
	})
</script>

{#snippet startup()}
	<JazzStartup error={sessionError} />
{/snippet}

{#if jazzSession}
	<JazzSessionProvider session={jazzSession} fallback={startup}>
		<WorkspaceBootstrap filters={financeFilters}>{@render children()}</WorkspaceBootstrap>
	</JazzSessionProvider>
{:else}
	<JazzStartup error={sessionError} />
{/if}
