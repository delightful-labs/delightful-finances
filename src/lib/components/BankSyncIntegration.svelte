<script lang="ts">
	import { getContext, onDestroy, setContext, type Snippet } from 'svelte'
	import {
		bankSyncKey,
		getReadiness,
		type BankSyncContext,
		type BankSyncControls,
		type BankSyncEvent
	} from '#lib/bank-sync.js'
	import { beforeNavigate } from '$app/navigation'
	import { fromStore, readable } from 'svelte/store'
	import { getDb, getJazzSession, QuerySubscription, QuerySubscriptionOne } from 'jazz-tools/svelte'
	import { selectBankView } from '#lib/machines/bank-sync/index.js'
	import { createBankTrace } from '#lib/integrations/diagnostics.js'
	import { app, type Organization } from '#lib/schema.js'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import { financeFiltersKey, type FinanceFilters } from '#lib/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import BankSync from '#lib/components/BankSync.svelte'
	import QueryContent from '#lib/components/QueryContent.svelte'

	let {
		children,
		browserOffline,
		organizations,
		organizationsLoading,
		organizationsError,
		onSelectOrganization
	}: {
		browserOffline: boolean
		children: Snippet<[BankSyncControls]>
		organizations: readonly Organization[] | undefined
		organizationsLoading: boolean
		organizationsError: unknown
		onSelectOrganization: (id: string | null) => void
	} = $props()
	const db = getDb()
	const session = fromStore(getJazzSession())
	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const organizationId = $derived(filters.activeOrganizationId)
	const userId = $derived(session.current.account?.id)
	const membershipQuery = new QuerySubscriptionOne(() =>
		organizationMembershipQuery(organizationId, userId)
	)
	const connectionQuery = new QuerySubscription(() =>
		organizationId && userId
			? app.simplefinConnections.where({ organizationId, ownerId: userId })
			: undefined
	)
	const accountQuery = new QuerySubscription(() =>
		organizationId
			? app.accounts.where({ organizationId, archivedAt: { isNull: true } })
			: undefined
	)
	const linkQuery = new QuerySubscription(() =>
		organizationId ? app.simplefinAccountLinks.where({ organizationId }) : undefined
	)
	const read = () => ({
		organizationId,
		userId,
		sessionReady: session.current.status === 'ready',
		membership: membershipQuery.current,
		connections: connectionQuery.current ?? [],
		accounts: accountQuery.current ?? [],
		links: linkQuery.current ?? []
	})
	const readReadiness = () => ({
		source: read(),
		sessionStatus: session.current.status,
		membershipLoading: membershipQuery.isLoading,
		membershipError: membershipQuery.error,
		organizations,
		organizationsLoading,
		organizationsError
	})
	const readiness = getReadiness()
	const readinessActor = readiness.actor
	readinessActor.send({
		type: 'ATTACH_WORKSPACE',
		attachment: {
			dependencies: { db, read, passkeyName: () => m['app.name']() },
			read: readReadiness,
			selectOrganization: (id) => onSelectOrganization(id)
		}
	})
	const workspaceActor = readinessActor.getSnapshot().context.workspace
	if (!workspaceActor) throw new Error('Application readiness must own the workspace actor')
	const actorRef = workspaceActor.getSnapshot().children.bank
	if (!actorRef) throw new Error('Workspace readiness must own the bank actor')
	const send = (event: BankSyncEvent) => workspaceActor.send({ type: 'BANK', event })
	// Child state changes can leave the root snapshot identity unchanged.
	const snapshot = readable(actorRef.getSnapshot(), (set) => {
		const subscription = actorRef.subscribe(set)
		return () => subscription.unsubscribe()
	})
	const bankState = fromStore(snapshot)
	const view = $derived(selectBankView(bankState.current))
	const workflowTrace = createBankTrace('workflow')
	function dispatch(event: BankSyncEvent) {
		workflowTrace.log('event', {
			event: event.type,
			state: view.setupView ?? (bankState.current.matches('running') ? 'running' : 'idle')
		})
		send(event)
	}
	$effect(() => {
		workflowTrace.log('queries', {
			loading: [membershipQuery, connectionQuery, accountQuery, linkQuery].some(
				(query) => query.isLoading
			),
			failed: [membershipQuery, connectionQuery, accountQuery, linkQuery].some((query) =>
				Boolean(query.error)
			)
		})
		for (const [label, error] of [
			['membership', membershipQuery.error],
			['connection', connectionQuery.error],
			['accounts', accountQuery.error],
			['mappings', linkQuery.error]
		]) {
			if (error) workflowTrace.failed(`query.${label}.failed`, error)
		}
	})
	$effect(() => {
		workspaceActor.send({ type: 'OBSERVED', observation: readReadiness() })
	})
	const controls: BankSyncContext = {
		actor: actorRef,
		snapshot,
		get status() {
			return view.status
		},
		get outcome() {
			return view.outcome
		},
		get visible() {
			return view.showSync
		},
		get disabled() {
			return view.busy
		},
		sync: () => dispatch({ type: 'SYNC' }),
		cancel: () => dispatch({ type: 'CANCEL' }),
		get view() {
			return bankView
		}
	}
	setContext(bankSyncKey, controls)
	beforeNavigate(() => dispatch({ type: 'CANCEL' }))
	onDestroy(() => readinessActor.send({ type: 'DETACH_WORKSPACE', actor: workspaceActor }))
</script>

{#snippet bankView()}
	<QueryContent
		queries={[membershipQuery, connectionQuery, accountQuery, linkQuery]}
		loadingMessage={m['status.loading']({ subject: m['bank.title']() })}
		errorMessage={m['errors.load']({ subject: m['bank.title']() })}
	>
		{#key `${userId}:${organizationId}`}
			<BankSync
				{browserOffline}
				status={view.status}
				setupView={view.setupView}
				setupStep={view.setupStep}
				onTestEncryption={() => dispatch({ type: 'TEST_ENCRYPTION' })}
				onVerifyDecryption={() => dispatch({ type: 'VERIFY_DECRYPTION' })}
				onSaveConnection={() => dispatch({ type: 'SAVE_CONNECTION' })}
				busy={view.busy}
				loadingProvider={view.loadingProvider}
				showSetup={view.showSetup}
				showConnected={view.showConnected}
				showRecovery={view.showRecovery}
				showRestricted={view.showRestricted}
				showStatus={view.showStatus}
				providerAccounts={view.providerAccounts}
				outcome={view.outcome}
				onConnect={(token) => dispatch({ type: 'CONNECT', token })}
				onDiscover={() => dispatch({ type: 'DISCOVER' })}
				onSync={() => dispatch({ type: 'SYNC' })}
				onMap={(providerId, accountId) => dispatch({ type: 'MAP', providerId, accountId })}
				onCreateAccount={(providerId) => dispatch({ type: 'CREATE_ACCOUNT', providerId })}
				onDisconnect={() => dispatch({ type: 'DISCONNECT' })}
				onCancel={() => dispatch({ type: 'CANCEL' })}
			/>
		{/key}
	</QueryContent>
{/snippet}

{@render children(controls)}
