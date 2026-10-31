<script lang="ts">
	import { setContext, type Snippet, type ComponentProps } from 'svelte'
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
	import { QuerySubscription } from 'jazz-tools/svelte'
	import { app } from '#lib/schema.js'
	import BankSyncLog from './BankSyncLog.svelte'
	import {
		selectHistoryConnection,
		historyPageLimit,
		nextHistoryPage,
		selectHistoryPage,
		selectHistoryAccounts
	} from './bank-sync-history.js'
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
	const historyScope = $derived(`${userId}:${historyOrganizationId}`)
	let historySelection = $state({ scope: '', id: '' })
	const selectedHistory = $derived(
		selectHistoryConnection(
			logConnections.current ?? [],
			historyOrganizationId,
			historySelection,
			historyScope,
			bankState.current.context.connection?.id
		)
	)
	const historyConnections = $derived(selectedHistory.connections)
	const logConnectionId = $derived(selectedHistory.connectionId)
	const logScope = $derived(`${userId}:${organizationId}:${logConnectionId}`)
	let logPage = $state({ scope: '', limit: 20 })
	const logLimit = $derived(historyPageLimit(logPage, logScope))
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
	const historyPage = $derived(
		selectHistoryPage(
			logAttempts.current ?? [],
			historyConnections,
			organizationId,
			logConnectionId,
			logLimit
		)
	)
	const attemptIds = $derived(historyPage.attemptIds)
	const logAccounts = new QuerySubscription(() =>
		organizationId && attemptIds.length
			? app.simplefinSyncAccountResults.where({ organizationId, attemptId: { in: attemptIds } })
			: undefined
	)
	const logProfiles = new QuerySubscription(() =>
		historyPage.initiatorIds.length
			? app.profiles.where({ userId: { in: historyPage.initiatorIds } })
			: undefined
	)
	const historyAccounts = $derived(
		selectHistoryAccounts(logAccounts.current ?? [], organizationId, attemptIds)
	)
	function selectConnection(id: string) {
		historySelection = { scope: historyScope, id }
	}
	function loadEarlier() {
		logPage = nextHistoryPage(logPage, logScope)
	}
	$effect(() => {
		actorRef.send({ type: 'NETWORK_CHANGED', offline: browserOffline })
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
					queries={[logConnections, logAttempts, logAccounts]}
					loadingMessage={m['status.loading_subject']({ subject: m['bank.log_title']() })}
					errorMessage={m['errors.load_subject']({ subject: m['bank.log_title']() })}
				>
					<BankSyncLog
						connections={historyConnections}
						connectionId={logConnectionId}
						onConnection={selectConnection}
						attempts={historyPage.attempts}
						accounts={historyAccounts}
						profiles={logProfiles.error ? [] : (logProfiles.current ?? [])}
						hasEarlier={historyPage.hasEarlier}
						onEarlier={loadEarlier}
					/>
				</QueryContent>
			{/if}
		{/key}
	</QueryContent>
{/snippet}

{@render children(controls)}
