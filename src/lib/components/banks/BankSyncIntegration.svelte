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
		{/key}
	</QueryContent>
{/snippet}

{@render children(controls)}
