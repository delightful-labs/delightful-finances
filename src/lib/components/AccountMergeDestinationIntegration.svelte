<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import { createActor } from 'xstate'
	import type { getDb, JazzClient, JazzSession } from 'jazz-tools/svelte'
	import { app } from '#lib/schema.js'
	import { createAccountMergeDestinationMachine } from '#lib/machines/account-merge/destination.js'
	import type {
		MergeDestination,
		MergeDestinationResult,
		MergeDestinationDependencies
	} from '#lib/schema/account-merge-destination.js'

	let {
		db,
		session,
		destination,
		organizationId,
		onResult
	}: {
		db: ReturnType<typeof getDb>
		session: JazzSession<JazzClient>
		destination: MergeDestination
		organizationId: string | null
		onResult: (result: MergeDestinationResult) => void
	} = $props()
	// One mounted component owns one request and exact client binding. The caller
	// keys/replaces the component for another request rather than retargeting a check.
	const bound = untrack(() => ({ db, session, destination }))
	const workspaceObservers = new Set<() => void>()
	const dependencies: MergeDestinationDependencies = {
		binding: bound.db,
		session: (callbacks) => {
			const publish = () => {
				// SDK notifications and reactive workspace changes run outside XState.
				try {
					const current = bound.session.getSnapshot()
					callbacks.next({
						ready: current.status === 'ready',
						identityId: current.account?.id ?? null,
						organizationId,
						binding: current.client?.db ?? null
					})
				} catch {
					callbacks.error()
				}
			}
			const unsubscribe = bound.session.subscribe(publish)
			workspaceObservers.add(publish)
			publish()
			return () => {
				workspaceObservers.delete(publish)
				unsubscribe()
			}
		},
		organization: (requested, callbacks) =>
			bound.db.subscribe(
				app.organizations.where({ id: requested.organizationId }),
				{ onUpdate: callbacks.next, onError: () => callbacks.error() },
				{ tier: 'remote' }
			),
		membership: (requested, callbacks) =>
			bound.db.subscribe(
				app.organizationMembers.where({
					organizationId: requested.organizationId,
					userId: requested.identityId
				}),
				{ onUpdate: callbacks.next, onError: () => callbacks.error() },
				{ tier: 'remote' }
			)
	}
	export const actor = createActor(createAccountMergeDestinationMachine(dependencies), {
		input: bound.destination
	})
	$effect(() => {
		void organizationId
		untrack(() => workspaceObservers.forEach((publish) => publish()))
	})
	onMount(() => {
		const completion = actor.subscribe({
			complete: () => {
				const result = actor.getSnapshot().output
				if (result) onResult(result)
			}
		})
		actor.start()
		return () => {
			// This child owns only synchronous subscription cleanup. Complete shutdown
			// before stopping so disposal is part of the statechart's terminal path.
			if (actor.getSnapshot().status === 'active') actor.send({ type: 'SHUTDOWN' })
			completion.unsubscribe()
			actor.stop()
		}
	})
</script>
