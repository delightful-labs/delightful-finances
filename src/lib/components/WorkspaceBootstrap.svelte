<script lang="ts">
	import { type Snippet } from 'svelte'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import { ensurePersonalWorkspace } from '#lib/data.js'
	import { m } from '#lib/paraglide/messages.js'
	import AppShell from './AppShell.svelte'
	import JazzStartup from './JazzStartup.svelte'
	import type { FinanceFilters } from '#lib/finance-filters.js'

	let { children, filters }: { children: Snippet; filters: FinanceFilters } = $props()
	const session = getJazzSession()
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
		void ensurePersonalWorkspace(getDb(), userId)
			.then(() => {
				if (currentAttempt === attempt) ready = true
			})
			.catch(() => {
				if (currentAttempt === attempt) setupError = true
			})
	})
</script>

{#if ready}
	<AppShell {filters}>{@render children()}</AppShell>
{:else if setupError}
	<JazzStartup error workspace />
{:else}
	<JazzStartup workspace />
{/if}
