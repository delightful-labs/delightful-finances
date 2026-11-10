<script lang="ts">
	import 'delightful-ui/theme.css'
	import type { Snippet } from 'svelte'
	let { children }: { children: Snippet } = $props()
	import {
		PUBLIC_JAZZ_APP_ID,
		PUBLIC_JAZZ_SERVER_URL,
		PUBLIC_SIMPLEFIN_DEMO
	} from '$app/env/public'
	import { browser } from '$app/env'
	import WorkerApplication from '#lib/components/startup/WorkerApplication.svelte'
	import PwaUpdateIntegration from '#lib/components/pwa/PwaUpdateIntegration.svelte'
	import DemoViewport from '#lib/components/diagnostics/DemoViewport.svelte'

	const serverUrl = browser
		? new URL(
				PUBLIC_JAZZ_SERVER_URL === 'same-origin' ? '/jazz' : PUBLIC_JAZZ_SERVER_URL || '/jazz',
				window.location.origin
			).href
		: '/jazz'
	const legacyScope = PUBLIC_JAZZ_SERVER_URL !== 'same-origin' ? PUBLIC_JAZZ_APP_ID : ''
</script>

<DemoViewport enabled={PUBLIC_SIMPLEFIN_DEMO === 'true'} />
<PwaUpdateIntegration />
<WorkerApplication {serverUrl} {legacyScope}>{@render children()}</WorkerApplication>
