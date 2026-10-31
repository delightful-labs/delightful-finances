<script lang="ts">
	import { setContext, onMount, type Snippet, type ComponentProps } from 'svelte'
	import {
		bankSyncKey,
		type BankSyncContext,
		type BankSyncControls,
		type BankSyncEvent
	} from '#lib/runtime/bank-sync.js'
	import { getWorkspace } from '#lib/runtime/workspace.js'
	import { workspaceBankActor } from '#lib/machines/runtime/readiness.js'
	import { beforeNavigate } from '$app/navigation'
	import { page } from '$app/state'
	import { QuerySubscription, getDb } from 'jazz-tools/svelte'
	import { createActor } from 'xstate'
	import { inspectActor } from '#lib/diagnostics/inspector.js'
	import { createSyncLogRetentionCoordinator } from '#lib/machines/bank-sync/log-retention-coordinator.js'
	import { app } from '#lib/schema.js'
	import BankSyncLog from './BankSyncLog.svelte'
	import { fromStore, readable } from 'svelte/store'
	import { selectBankView } from '#lib/machines/bank-sync/index.js'
	import { createBankTrace } from '#lib/integrations/diagnostics.js'
	import { m } from '#lib/paraglide/messages.js'
	import BankSync from '#lib/components/banks/BankSync.svelte'
	import QueryContent from '#lib/components/shared/QueryContent.svelte'

	let {
		children,
		browserOffline,
		queries,
		userId,
		organizationId
	}: {
		browserOffline: boolean
		children: Snippet<[BankSyncControls]>
		queries: ComponentProps<typeof QueryContent>['queries']
		userId: string | undefined
		organizationId: string | null
	} = $props()
	const workspace = getWorkspace()
	const workspaceActor = workspace.actor
	if (!workspaceActor) throw new Error('Workspace integration must own the coordinator')
	const actorRef = workspaceBankActor(workspaceActor.getSnapshot())
	if (!actorRef) throw new Error('Workspace readiness must own the bank actor')
	const send = (event: BankSyncEvent) => workspaceActor.send({ type: 'BANK', event })
	const syncDisabled = $derived(!workspace.view.canSync)

	// Child state changes can leave the root snapshot identity unchanged.
	const snapshot = readable(actorRef.getSnapshot(), (set) => {
		const subscription = actorRef.subscribe(set)
		return () => subscription.unsubscribe()
	})
	const bankState = fromStore(snapshot)
	const view = $derived(selectBankView(bankState.current))
	const historyOrganizationId = $derived(
		page.url.pathname === '/settings/banks' && bankState.current.context.access.kind === 'allowed'
			? bankState.current.context.access.organizationId
			: undefined
	)
	const logConnections = new QuerySubscription(() =>
		historyOrganizationId
			? app.simplefinConnections
					.where({ organizationId: historyOrganizationId })
					.orderBy('claimedAt', 'desc')
					.orderBy('id', 'desc')
			: undefined
	)
	const historyConnections = $derived(
		(logConnections.current ?? []).filter((row) => row.organizationId === historyOrganizationId)
	)
	const historyScope = $derived(`${userId}:${historyOrganizationId}`)
	let historySelection = $state({ scope: '', id: '' })
	const logConnectionId = $derived(
		historySelection.scope === historyScope &&
			historyConnections.some((row) => row.id === historySelection.id)
			? historySelection.id
			: (historyConnections.find((row) => row.id === bankState.current.context.connection?.id)
					?.id ?? historyConnections[0]?.id)
	)
	const logScope = $derived(`${userId}:${organizationId}:${logConnectionId}`)
	let logPage = $state({ scope: '', limit: 20 })
	const logLimit = $derived(logPage.scope === logScope ? logPage.limit : 20)
	$effect(() => {
		if (logPage.scope !== logScope) logPage = { scope: logScope, limit: 20 }
	})
	const logAttempts = new QuerySubscription(() =>
		logConnectionId && organizationId
			? app.simplefinSyncAttempts
					.where({ organizationId, connectionId: logConnectionId })
					.orderBy('startedAt', 'desc')
					.orderBy('id', 'desc')
					.limit(logLimit + 1)
			: undefined
	)
	const scopedAttempts = $derived(
		(logAttempts.current ?? []).filter(
			(row) =>
				Boolean(logConnectionId) &&
				row.connectionId === logConnectionId &&
				row.organizationId === organizationId
		)
	)
	const visibleAttempts = $derived(scopedAttempts.slice(0, logLimit))
	const attemptIds = $derived(visibleAttempts.map((row) => row.id))
	const logAccounts = new QuerySubscription(() =>
		organizationId && attemptIds.length
			? app.simplefinSyncAccountResults.where({ organizationId, attemptId: { in: attemptIds } })
			: undefined
	)
	const initiatorIds = $derived([
		...new Set([
			...visibleAttempts.map((row) => row.initiatedBy),
			...historyConnections.flatMap((row) => (row.ownerId ? [row.ownerId] : []))
		])
	])
	const logProfiles = new QuerySubscription(() =>
		initiatorIds.length ? app.profiles.where({ userId: { in: initiatorIds } }) : undefined
	)
	const retention = createActor(
		createSyncLogRetentionCoordinator({
			db: getDb(),
			observe: () => ({
				organizationId: bankState.current.context.access.organizationId,
				userId: bankState.current.context.access.userId,
				allowed: bankState.current.context.access.kind === 'allowed',
				connected: !browserOffline,
				sessionReady: bankState.current.context.access.kind === 'allowed',
				connection: undefined
			})
		}),
		{ inspect: inspectActor }
	)
	onMount(() => {
		retention.start()
		return () => retention.send({ type: 'SHUTDOWN' })
	})
	$effect(() => {
		const access = bankState.current.context.access
		const selected = historyConnections.find(
			(row) => row.id === logConnectionId && row.ownerId === access.userId
		)
		const connectionId = selected?.id ?? bankState.current.context.connection?.id
		retention.send({
			type: 'CHECK',
			scope:
				access.kind === 'allowed' && !browserOffline && connectionId
					? { organizationId: access.organizationId, userId: access.userId, connectionId }
					: undefined,
			completion: bankState.current.context.logging?.attemptId
		})
	})
	const workflowTrace = createBankTrace('workflow')
	function dispatch(event: BankSyncEvent) {
		workflowTrace.log('event', {
			event: event.type,
			state:
				(view.mode.kind === 'setup' ? view.mode.stage : null) ??
				(bankState.current.matches('running') ? 'running' : 'idle')
		})
		send(event)
	}
	$effect(() => {
		workflowTrace.log('queries', {
			loading: queries.some((query) => query.isLoading),
			failed: queries.some((query) => Boolean(query.error))
		})
		for (const [index, query] of queries.entries()) {
			if (query.error) workflowTrace.failed(`query.${index}.failed`, query.error)
		}
	})

	const controls: BankSyncContext = {
		actor: actorRef,
		snapshot,
		get status() {
			return view.status
		},
		get outcome() {
			return view.history
		},
		get visible() {
			return view.mode.kind === 'connected'
		},
		get disabled() {
			return view.activity.kind === 'working' || syncDisabled
		},
		get loading() {
			return view.activity.kind === 'working'
		},
		sync: () => dispatch({ type: 'SYNC' }),
		cancel: () => dispatch({ type: 'CANCEL' }),
		get view() {
			return bankView
		}
	}
	setContext(bankSyncKey, controls)
	beforeNavigate(() => dispatch({ type: 'CANCEL' }))
</script>

{#snippet bankView()}
	<QueryContent
		{queries}
		loadingMessage={m['status.loading_subject']({ subject: m['bank.title']() })}
		errorMessage={m['errors.load_subject']({ subject: m['bank.title']() })}
	>
		{#key `${userId}:${organizationId}`}
			<BankSync
				{browserOffline}
				{view}
				{syncDisabled}
				onTestEncryption={() => dispatch({ type: 'TEST_ENCRYPTION' })}
				onVerifyDecryption={() => dispatch({ type: 'VERIFY_DECRYPTION' })}
				onSaveConnection={() => dispatch({ type: 'SAVE_CONNECTION' })}
				onConnect={(token) => dispatch({ type: 'CONNECT', token })}
				onDiscover={() => dispatch({ type: 'DISCOVER' })}
				onSync={() => dispatch({ type: 'SYNC' })}
				onMap={(providerId, accountId) => dispatch({ type: 'MAP', providerId, accountId })}
				onCreateAccount={(providerId) => dispatch({ type: 'CREATE_ACCOUNT', providerId })}
				onDisconnect={() => dispatch({ type: 'DISCONNECT' })}
				onCancel={() => dispatch({ type: 'CANCEL' })}
			/>
			{#if historyOrganizationId}
				<QueryContent
					queries={[logConnections, logAttempts, logAccounts, logProfiles]}
					loadingMessage={m['status.loading_subject']({ subject: m['bank.log_title']() })}
					errorMessage={m['errors.load_subject']({ subject: m['bank.log_title']() })}
				>
					<BankSyncLog
						connections={historyConnections}
						connectionId={logConnectionId}
						onConnection={(id) => {
							historySelection = { scope: historyScope, id }
						}}
						attempts={visibleAttempts}
						accounts={(logAccounts.current ?? []).filter(
							(row) => row.organizationId === organizationId && attemptIds.includes(row.attemptId)
						)}
						profiles={logProfiles.current ?? []}
						{userId}
						hasEarlier={scopedAttempts.length > logLimit}
						onEarlier={() => {
							logPage = { scope: logScope, limit: logLimit + 20 }
						}}
					/>
				</QueryContent>
			{/if}
		{/key}
	</QueryContent>
{/snippet}

{@render children(controls)}
