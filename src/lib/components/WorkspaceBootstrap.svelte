<script lang="ts">
	import type { Snippet } from 'svelte'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import { ensurePersonalWorkspace } from '#lib/data.js'
	import AppShell from './AppShell.svelte'
	import JazzStartup from './JazzStartup.svelte'

	let { children }: { children: Snippet } = $props()
	const session = getJazzSession()
	const db = getDb()
	let ready = $state(false)
	let setupError = $state(false)
	let attempt = 0

	$effect(() => {
		if ($session.status !== 'ready' || !$session.account) {
			attempt += 1
			ready = false
			setupError = false
			return
		}

		const currentAttempt = ++attempt
		const userId = $session.account.id
		ready = false
		setupError = false
		void ensurePersonalWorkspace(db, userId)
			.then(() => {
				if (currentAttempt === attempt) ready = true
			})
			.catch(() => {
				if (currentAttempt === attempt) setupError = true
			})
	})
</script>

{#if ready}
	<AppShell>{@render children()}</AppShell>
{:else if setupError}
	<JazzStartup error workspace />
{:else}
	<JazzStartup workspace />
{/if}
