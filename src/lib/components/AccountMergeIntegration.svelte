<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import { createActor } from 'xstate'
	import { fromStore, readable } from 'svelte/store'
	import { PUBLIC_JAZZ_APP_ID } from '$app/env/public'
	import AccountMerge from './AccountMerge.svelte'
	import { createMergeJournalStore } from '#lib/account-merge/journal.js'
	import type { QueryBuilder } from 'jazz-tools'
	import type { getDb, JazzClient, JazzSession } from 'jazz-tools/svelte'
	import { app } from '#lib/schema.js'
	import { accountMergeSnapshotSchema } from '#lib/validation/account-merge.js'
	import {
		createAccountMergeMachine,
		selectAccountMergeView
	} from '#lib/machines/account-merge/coordinator.js'
	import type {
		MergeCaptureDependencies,
		MergeCaptureScope
	} from '#lib/schema/account-merge-capture.js'
	import type {
		MergeObservationCallbacks,
		MergeDestinationSession
	} from '#lib/schema/account-merge-destination.js'

	let {
		db,
		session,
		organizationId
	}: {
		db: ReturnType<typeof getDb>
		session: JazzSession<JazzClient>
		organizationId: string | null
	} = $props()
	const bound = untrack(() => ({ db, session }))
	const sessionObservers = new Set<MergeObservationCallbacks<MergeDestinationSession>>()
	let unsubscribeSession: (() => void) | undefined
	function publish() {
		try {
			const current = bound.session.getSnapshot()
			const observation = {
				ready: current.status === 'ready',
				identityId: current.account?.id ?? null,
				organizationId,
				binding: current.client?.db ?? null
			}
			sessionObservers.forEach((callbacks) => callbacks.next(observation))
		} catch {
			sessionObservers.forEach((callbacks) => callbacks.error())
		}
	}

	const shape = accountMergeSnapshotSchema.shape
	// The wire schema is the field allowlist. No audit columns or credentials enter
	// the actor. Jazz timestamps become the snapshot's ISO strings; absent nullable
	// columns become explicit nulls without applying form defaults/transforms.
	function observe<T extends Record<string, unknown> & { id: string }>(
		query: QueryBuilder<T>,
		fields: readonly string[],
		callbacks: MergeObservationCallbacks<readonly unknown[]>
	) {
		return bound.db.subscribe(
			query,
			{
				onUpdate: (rows) => {
					// Later SDK callbacks execute outside the invoked actor. Bridge
					// projection failures back to its ordinary failure transition.
					try {
						callbacks.next(
							rows.map((row) =>
								Object.fromEntries(
									fields.map((field) => {
										const value = row[field]
										return [field, value instanceof Date ? value.toISOString() : (value ?? null)]
									})
								)
							)
						)
					} catch {
						callbacks.error()
					}
				},
				onError: () => callbacks.error()
			},
			{ tier: 'local-first' }
		)
	}
	const reads: Record<
		MergeCaptureScope,
		(organizationId: string, callbacks: MergeObservationCallbacks<readonly unknown[]>) => () => void
	> = {
		sourceOrganization: (id, callbacks) =>
			observe(
				app.organizations.where({ id }),
				Object.keys(shape.sourceOrganization.shape),
				callbacks
			),
		accounts: (organizationId, callbacks) =>
			observe(
				app.accounts.where({ organizationId }),
				Object.keys(shape.accounts.element.shape),
				callbacks
			),
		categories: (organizationId, callbacks) =>
			observe(
				app.categories.where({ organizationId }),
				Object.keys(shape.categories.element.shape),
				callbacks
			),
		tags: (organizationId, callbacks) =>
			observe(app.tags.where({ organizationId }), Object.keys(shape.tags.element.shape), callbacks),
		transactions: (organizationId, callbacks) =>
			observe(
				app.transactions.where({ organizationId }),
				Object.keys(shape.transactions.element.shape),
				callbacks
			),
		checkDetails: (organizationId, callbacks) =>
			observe(
				app.checkDetails.where({ organizationId }),
				Object.keys(shape.checkDetails.element.shape),
				callbacks
			),
		transactionTags: (organizationId, callbacks) =>
			observe(
				app.transactionTags.where({ organizationId }),
				Object.keys(shape.transactionTags.element.shape),
				callbacks
			),
		transactionBatches: (organizationId, callbacks) =>
			observe(
				app.transactionBatches.where({ organizationId }),
				Object.keys(shape.transactionBatches.element.shape),
				callbacks
			),
		batchTemplates: (organizationId, callbacks) =>
			observe(
				app.batchTemplates.where({ organizationId }),
				Object.keys(shape.batchTemplates.element.shape),
				callbacks
			),
		bankAccountLinks: (organizationId, callbacks) =>
			observe(
				app.simplefinAccountLinks.where({ organizationId }),
				Object.keys(shape.bankAccountLinks.element.shape),
				callbacks
			),
		connections: (organizationId, callbacks) =>
			observe(app.simplefinConnections.where({ organizationId }).select('id'), ['id'], callbacks)
	}
	const dependencies: MergeCaptureDependencies = {
		binding: bound.db,
		session: (callbacks) => {
			sessionObservers.add(callbacks)
			// The first actor acquires the SDK observer; subsequent children share
			// it. Startup failures propagate to the invoking actor's onError.
			if (sessionObservers.size === 1) {
				try {
					unsubscribeSession = bound.session.subscribe(publish)
				} catch (error) {
					sessionObservers.delete(callbacks)
					throw error
				}
			}
			publish()
			return () => {
				sessionObservers.delete(callbacks)
				if (sessionObservers.size === 0) {
					unsubscribeSession?.()
					unsubscribeSession = undefined
				}
			}
		},
		read: (requested, scope, callbacks) => reads[scope](requested.organizationId, callbacks),
		attachments: (transactionIds, callbacks) => {
			if (transactionIds.length === 0) {
				callbacks.next([])
				return () => {}
			}
			return observe(
				app.transactionAttachments.where({ transactionId: { in: transactionIds } }),
				Object.keys(shape.transactionAttachments.element.shape),
				callbacks
			)
		}
	}
	const actor = createActor(
		createAccountMergeMachine(dependencies, createMergeJournalStore(PUBLIC_JAZZ_APP_ID))
	)
	const snapshot = fromStore(
		readable(actor.getSnapshot(), (set) => {
			const subscription = actor.subscribe(set)
			return () => subscription.unsubscribe()
		})
	)
	const view = $derived(selectAccountMergeView(snapshot.current))
	$effect(() => {
		void organizationId
		untrack(publish)
	})
	onMount(() => {
		actor.subscribe({ complete: () => actor.stop() })
		actor.start()
		publish()
		return () => {
			// Let journal cancellation settle even after navigation removes this
			// component. Final completion releases children before stopping root.
			actor.send({ type: 'SHUTDOWN' })
		}
	})
</script>

<AccountMerge
	{view}
	onCapture={() => actor.send({ type: 'CAPTURE' })}
	onSave={() => actor.send({ type: 'SAVE' })}
	onDiscard={() => actor.send({ type: 'DISCARD' })}
	onRetry={() => actor.send({ type: 'RETRY' })}
	onCancel={() => actor.send({ type: 'CANCEL' })}
/>
