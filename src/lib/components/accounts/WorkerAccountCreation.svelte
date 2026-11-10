<script lang="ts">
	import { untrack, type Snippet } from 'svelte'
	import { FieldFeedback } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	import { createActor, type ActorRefFrom, type SnapshotFrom } from 'xstate'
	import {
		nativeNameInputMachine,
		selectNativeNameInput
	} from '#lib/machines/runtime/native-name-input.js'
	import { fromStore } from 'svelte/store'
	import { getFinanceUiRuntime, type FinanceUiRuntime } from '#lib/runtime/finance-ui.js'
	import type { AccountFormIntent } from '#lib/runtime/worker/form-protocol.js'
	import AccountForm from './AccountForm.svelte'

	let {
		trigger,
		runtime = getFinanceUiRuntime()
	}: {
		trigger?: Snippet<[() => void, boolean]> | undefined
		runtime?: FinanceUiRuntime
	} = $props()
	const snapshotStore = $derived(fromStore(runtime.view))
	const workspace = $derived(snapshotStore.current?.workspace)
	const generation = $derived(workspace?.generation ?? 0)
	let nativeActor = $state.raw<ActorRefFrom<typeof nativeNameInputMachine>>()
	let nativeSnapshot = $state.raw<SnapshotFrom<typeof nativeNameInputMachine>>()
	const identity = $derived(`${generation}:${workspace?.accountForm.draftRevision}`)
	const nativeStatus = $derived(selectNativeNameInput(nativeSnapshot))
	const nativeView = $derived(
		workspace
			? {
					...workspace.accountForm,
					canSubmit: workspace.accountForm.canSubmit && !nativeStatus.busy,
					canReset: workspace.accountForm.canReset && !nativeStatus.busy,
					fieldsEditable: workspace.accountForm.fieldsEditable && !nativeStatus.busy
				}
			: undefined
	)
	$effect(() => {
		const capturedIdentity = identity
		return untrack(() => {
			if (!workspace) return
			const generation = workspace.generation,
				draftRevision = workspace.accountForm.draftRevision
			const actor = createActor(nativeNameInputMachine, {
				input: {
					requestId: crypto.randomUUID(),
					exchange: (command, signal) =>
						runtime.exchangeText?.(
							{ type: 'NAME_TEXT', generation, form: 'account', draftRevision, command },
							signal
						) ?? Promise.resolve(undefined)
				}
			})
			nativeActor = actor
			const subscription = actor.subscribe((snapshot) => {
				if (identity === capturedIdentity) nativeSnapshot = snapshot
			})
			actor.start()
			return () => {
				if (actor.getSnapshot().status === 'active') actor.send({ type: 'SHUTDOWN' })
				subscription.unsubscribe()
				if (nativeActor === actor) {
					nativeActor = undefined
					nativeSnapshot = undefined
				}
			}
		})
	})
	function send(
		generation: number,
		command: AccountFormIntent,
		revision = workspace?.accountForm.draftRevision
	) {
		if (
			generation > 0 &&
			workspace?.generation === generation &&
			revision === workspace.accountForm.draftRevision
		)
			runtime.send({
				type: 'ACCOUNT_FORM',
				generation,
				draftRevision: workspace.accountForm.draftRevision,
				command
			})
	}
	function submit(event: SubmitEvent, generation: number) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		const data = new FormData(event.currentTarget)
		const text = (name: string) => {
			const value = data.get(name)
			return typeof value === 'string' ? value : ''
		}
		const capturedIdentity = identity,
			revision = workspace?.accountForm.draftRevision
		const kind = text('kind'),
			currency = text('currency')
		nativeActor?.send({
			type: 'PREPARE',
			name: text('name'),
			deliver: (name) => {
				if (identity === capturedIdentity)
					send(generation, { type: 'SUBMIT', values: { name, kind, currency } }, revision)
			}
		})
	}
</script>

{#if nativeStatus.failed}<FieldFeedback
		id="account-native-name-feedback"
		errorMessage={m['errors.operation_failed']()}
	/>{/if}
{#if workspace}
	{#key generation}
		{@const displayedGeneration = generation}
		<AccountForm
			scope={displayedGeneration}
			defaultCurrency={workspace.accountDefaultCurrency}
			{trigger}
			view={nativeView ?? workspace.accountForm}
			onopen={() => send(displayedGeneration, { type: 'OPEN' })}
			onsubmit={(event) => submit(event, displayedGeneration)}
			onreset={(event) => {
				event.preventDefault()
				send(displayedGeneration, { type: 'RESET' })
			}}
			onRetryReadiness={() => send(displayedGeneration, { type: 'RETRY_READINESS' })}
		/>
	{/key}
{/if}
