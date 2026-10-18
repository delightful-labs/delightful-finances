<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import { createActor } from 'xstate'
	import type { QueryBuilder } from 'jazz-tools'
	import type { getDb, JazzClient, JazzSession } from 'jazz-tools/svelte'
	import { app } from '#lib/schema.js'
	import { accountMergeSnapshotSchema } from '#lib/validation/account-merge.js'
	import { createAccountMergeCaptureMachine } from '#lib/machines/account-merge/capture.js'
	import type {
		MergeCaptureDependencies,
		MergeCaptureResult,
		MergeCaptureScope
	} from '#lib/schema/account-merge-capture.js'
	import type {
		MergeDestination,
		MergeObservationCallbacks
	} from '#lib/schema/account-merge-destination.js'

	let {
		db,
		session,
		source,
		organizationId,
		onResult
	}: {
		db: ReturnType<typeof getDb>
		session: JazzSession<JazzClient>
		source: MergeDestination
		organizationId: string | null
		onResult: (result: MergeCaptureResult) => void
	} = $props()
	const bound = untrack(() => ({ db, session, source }))
	const workspaceObservers = new Set<() => void>()
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
			const publish = () => {
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
	export const actor = createActor(createAccountMergeCaptureMachine(dependencies), {
		input: bound.source
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
			if (actor.getSnapshot().status === 'active') actor.send({ type: 'SHUTDOWN' })
			completion.unsubscribe()
			actor.stop()
		}
	})
</script>
