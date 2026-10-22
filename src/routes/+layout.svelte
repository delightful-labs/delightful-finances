<script lang="ts">
	import 'delightful-ui/theme.css'
	import {
		PUBLIC_JAZZ_APP_ID,
		PUBLIC_JAZZ_SERVER_URL,
		PUBLIC_SIMPLEFIN_DEMO
	} from '$app/env/public'
	import { onDestroy, onMount, setContext, type Snippet } from 'svelte'
	import { createActor } from 'xstate'
	import { fromStore, readable } from 'svelte/store'
	import { createApplicationReadinessMachine } from '#lib/machines/application-readiness.js'
	import { readinessKey, type ReadinessContext } from '#lib/bank-sync.js'
	import { JazzSessionProvider, type JazzSessionConfig } from 'jazz-tools/svelte'
	import DeveloperMenu from '#lib/components/DeveloperMenu.svelte'
	import DemoViewport from '#lib/components/DemoViewport.svelte'
	import JazzStartup from '#lib/components/JazzStartup.svelte'
	import SessionStartup from '#lib/components/SessionStartup.svelte'
	import WorkspaceBootstrap from '#lib/components/WorkspaceBootstrap.svelte'
	import { page } from '$app/state'
	import { queryLinksKey, type QueryLinkContext } from '#lib/query-links.js'
	import { browser } from '$app/env'
	import { workspaceRoute } from '#lib/domain/workspace-routes.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { getCurrentJazzSession, getOrCreateJazzSession } from '#lib/jazz-session.js'

	let { children }: { children: Snippet } = $props()
	const routeWorkspaceId = $derived(browser ? workspaceRoute(page.url.search).workspaceId : null)
	const accountFilter = $state<{ scope: string | null; ids: string[] | null }>({
		scope: null,
		ids: null
	})
	const financeFilters: FinanceFilters = {
		get activeOrganizationId() {
			return routeWorkspaceId
		},
		get selectedAccountIds() {
			return accountFilter.scope === routeWorkspaceId ? accountFilter.ids : null
		},
		set selectedAccountIds(value) {
			accountFilter.scope = routeWorkspaceId
			accountFilter.ids = value
		}
	}

	setContext<QueryLinkContext>(queryLinksKey, {
		get href() {
			return browser ? page.url.href : undefined
		},
		keys: ['workspace']
	})
	setContext(financeFiltersKey, financeFilters)

	const jazzConfig = {
		appId: PUBLIC_JAZZ_APP_ID,
		serverUrl: PUBLIC_JAZZ_SERVER_URL,
		initial: 'local-first'
	} satisfies JazzSessionConfig

	const actor = createActor(
		createApplicationReadinessMachine(
			() => getOrCreateJazzSession(jazzConfig),
			getCurrentJazzSession()
		)
	).start()
	const snapshot = readable(actor.getSnapshot(), (set) => {
		const subscription = actor.subscribe(set)
		return () => subscription.unsubscribe()
	})
	const readiness: ReadinessContext = { actor, snapshot }
	setContext(readinessKey, readiness)
	const startupState = fromStore(snapshot)
	const jazzSession = $derived(startupState.current.context.session)
	onMount(() => actor.send({ type: 'START' }))
	// The machine completes only after its workspace/bank children finish cleanup.
	onDestroy(() => actor.send({ type: 'SHUTDOWN' }))
</script>

<DeveloperMenu appId={jazzConfig.appId} serverUrl={jazzConfig.serverUrl} />

<DemoViewport enabled={PUBLIC_SIMPLEFIN_DEMO === 'true'} />

{#snippet startup()}
	<SessionStartup />
{/snippet}

{#if startupState.current.hasTag('startup-error')}
	<SessionStartup />
{:else if jazzSession}
	<JazzSessionProvider session={jazzSession} fallback={startup}>
		<WorkspaceBootstrap>{@render children()}</WorkspaceBootstrap>
	</JazzSessionProvider>
{:else}
	<JazzStartup
		error={startupState.current.hasTag('startup-error')}
		onRetry={() => actor.send({ type: 'RETRY' })}
	/>
{/if}
