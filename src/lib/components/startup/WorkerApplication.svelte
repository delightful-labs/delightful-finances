<script lang="ts">
	import { onMount, setContext, type Snippet } from 'svelte'
	import { writable } from 'svelte/store'
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { FinanceWindowConnection } from '#lib/runtime/worker/window-runtime-connection.js'
	import { createFinanceWindowRuntime } from '#lib/runtime/worker/window-runtime-facade.js'
	import { financeUiKey, type FinanceUiRuntime } from '#lib/runtime/finance-ui.js'
	import type { RuntimeView } from '#lib/runtime/worker/application-protocol.js'
	import { m } from '#lib/paraglide/messages.js'
	import JazzStartup from './JazzStartup.svelte'

	let {
		serverUrl,
		legacyScope,
		children: _children
	}: { serverUrl: string; legacyScope: string; children?: Snippet } = $props()
	const view = writable<RuntimeView | undefined>()
	let projected = $state.raw<RuntimeView>()
	let owner = $state.raw<ReturnType<typeof createFinanceWindowRuntime>>()
	let lifecycle = $state('starting')
	const runtime: FinanceUiRuntime = {
		view: { subscribe: view.subscribe },
		send: (intent) => owner?.context.send(intent),
		exchangeText: (intent, signal) =>
			owner?.context.exchangeText?.(intent, signal) ?? Promise.resolve(undefined)
	}
	setContext(financeUiKey, runtime)
	const route = $derived({
		pathname: page.url.pathname,
		search: page.url.search,
		hash: page.url.hash
	})
	onMount(() => {
		const connection = new FinanceWindowConnection({
			serverUrl,
			legacyScope,
			route,
			readHref: () => `${location.pathname}${location.search}${location.hash}`,
			navigate: (destination, replace) => goto(destination, { replaceState: replace }),
			reload: () => location.reload()
		})
		const application = createFinanceWindowRuntime(connection)
		owner = application
		const subscription = application.context.view.subscribe((next) => {
			projected = next
			view.set(next)
		})
		const status = application.lifecycle.subscribe((next) => {
			lifecycle = next
		})
		return () => {
			subscription()
			status()
			view.set(undefined)
			void application.close()
		}
	})
	$effect(() => {
		if (lifecycle === 'running') runtime.send({ type: 'ROUTE', route })
	})
</script>

<!-- The legacy shell requires a Window SDK. Keep route admission closed until
     the separately reviewed shell/route integration replaces that dependency. -->
<main
	data-finance-runtime="worker"
	data-finance-lifecycle={lifecycle}
	data-finance-session={projected?.session.status ?? 'starting'}
>
	<JazzStartup
		workspace={projected?.session.status === 'ready'}
		error={lifecycle === 'blocked' || projected?.startup.failed === true}
		message={projected?.startup.waitingForOtherVersion
			? m['database.version_conflict']()
			: undefined}
		{...lifecycle === 'blocked'
			? {}
			: { onRetry: () => runtime.send({ type: 'APPLICATION', command: { type: 'RETRY' } }) }}
	/>
</main>
