<script lang="ts">
	import { goto } from '$app/navigation'
	import WorkerTransactionTags from './WorkerTransactionTags.svelte'
	import type { NewTagPatch } from '#lib/contracts/transaction-new-tag-contract.js'
	import {
		nativeNameInputMachine,
		selectNativeNameInput
	} from '#lib/machines/runtime/native-name-input.js'
	import type { NativeFormDraft } from '#lib/machines/runtime/native-text-form.js'
	import { Button, FieldFeedback } from 'delightful-ui'
	import { createActor, type ActorRefFrom, type SnapshotFrom } from 'xstate'
	import {
		nativeTextFormMachine,
		selectNativeTextForm
	} from '#lib/machines/runtime/native-text-form.js'
	import { untrack, type Snippet } from 'svelte'
	import type { TransactionTextField } from '#lib/contracts/transaction-text-draft.js'
	import InternalTransferDeleteActions from '../transfers/InternalTransferDeleteActions.svelte'
	import type { TransactionEditIntent } from '#lib/runtime/worker/transaction-route-protocol.js'
	import SavedTransactionTagSelection from './SavedTransactionTagSelection.svelte'
	import { fromStore } from 'svelte/store'
	import { getFinanceUiRuntime, type FinanceUiRuntime } from '#lib/runtime/finance-ui.js'
	import type {
		TransactionRouteIntent,
		PublicTransactionRouteView
	} from '#lib/runtime/worker/transaction-route-protocol.js'
	import { m } from '#lib/paraglide/messages.js'
	import { formReasonText } from '#lib/forms/form-messages.js'
	import TransactionForm from './TransactionForm.svelte'
	import WorkerAccountCreation from '../accounts/WorkerAccountCreation.svelte'
	import FormFeedback from '../forms/FormFeedback.svelte'
	import PageLayout from '../navigation/PageLayout.svelte'
	import PageHeader from '../navigation/PageHeader.svelte'
	import CatalogPager from '../navigation/CatalogPager.svelte'

	let {
		runtime = getFinanceUiRuntime(),
		navigation = emptyNavigation,
		navigate = (href: string) => {
			void goto(href)
		}
	}: {
		runtime?: FinanceUiRuntime
		navigation?: Snippet
		navigate?: (href: string) => void
	} = $props()
	const snapshotStore = $derived(fromStore(runtime.view))
	const workspace = $derived(snapshotStore.current?.workspace)
	const view = $derived(workspace?.transaction)
	const transfer = $derived(view?.transfer)
	const transferSuggestions = $derived(
		transfer?.candidates.map((row) => ({
			...row,
			accountName: row.accountName ?? undefined,
			description: row.description ?? undefined
		})) ?? []
	)
	const writableTransferIds = $derived(
		new Set(transfer?.candidates.filter((row) => row.writable).map((row) => row.id) ?? [])
	)
	function edit(generation: number, formGeneration: number, command: TransactionEditIntent) {
		runtime.send({ type: 'TRANSACTION_EDIT', generation, formGeneration, command })
	}

	const draftIdentity = $derived(
		`${workspace?.generation}:${view?.generation}:${view?.form.draftRevision}`
	)
	let changedFields = $state<ReadonlySet<TransactionTextField>>(new Set())
	$effect(() => {
		void draftIdentity
		untrack(() => {
			changedFields = new Set()
		})
	})
	let tagActor = $state.raw<ActorRefFrom<typeof nativeNameInputMachine>>()
	let tagSnapshot = $state.raw<SnapshotFrom<typeof nativeNameInputMachine>>()
	const tagStatus = $derived(selectNativeNameInput(tagSnapshot))
	let nativeActor = $state.raw<ActorRefFrom<typeof nativeTextFormMachine>>()
	let nativeSnapshot = $state.raw<SnapshotFrom<typeof nativeTextFormMachine>>()
	let nativeError = $state(false)
	let loadedText = $state<{
		identity: string
		values: Partial<Record<TransactionTextField, string>>
	}>({ identity: '', values: {} })
	const nativeTextValues = $derived(loadedText.identity === draftIdentity ? loadedText.values : {})
	const nativeStatus = $derived(selectNativeTextForm(nativeSnapshot))
	const nativeFormReady = $derived(
		!!runtime.exchangeText &&
			view?.mode === 'active' &&
			!!view.route &&
			(!('transactionId' in view.route) || !!view.initialEntry)
	)
	const nativeFormView = $derived(
		view
			? {
					...view.form,
					canSubmit:
						view.form.canSubmit && !nativeStatus.busy && !nativeStatus.blocked && !tagStatus.busy,
					canReset: view.form.canReset && !nativeStatus.busy && !tagStatus.busy,
					fieldsEditable: view.form.fieldsEditable && !nativeStatus.blocked && !tagStatus.busy
				}
			: undefined
	)
	$effect(() => {
		const identity = draftIdentity
		const ready = nativeFormReady
		if (!ready) return
		return untrack(() => {
			const current = view,
				selected = workspace
			if (!current || !selected || !runtime.exchangeText) return
			const exchange = runtime.exchangeText
			const generation = selected.generation,
				formGeneration = current.generation,
				draftRevision = current.form.draftRevision
			loadedText = { identity, values: {} }
			nativeError = false
			const actor = createActor(nativeTextFormMachine, {
				input: {
					requestId: crypto.randomUUID(),
					readFields: current.readonlyFields.filter(isTextField),
					exchange: (command, signal) =>
						exchange(
							{ type: 'TRANSACTION_TEXT', generation, formGeneration, draftRevision, command },
							signal
						),
					loaded: (field, text) => {
						if (draftIdentity === identity)
							loadedText = { identity, values: { ...loadedText.values, [field]: text } }
					},
					deliver: (command) => {
						if (draftIdentity === identity) send(generation, formGeneration, command)
					},
					failed: () => {
						if (draftIdentity === identity) nativeError = true
					}
				}
			})
			const tags = createActor(nativeNameInputMachine, {
				input: {
					requestId: crypto.randomUUID(),
					exchange: (command, signal) =>
						exchange(
							{ type: 'TRANSACTION_TEXT', generation, formGeneration, draftRevision, command },
							signal
						)
				}
			})
			tagActor = tags
			const tagSubscription = tags.subscribe((snapshot) => {
				if (draftIdentity === identity) tagSnapshot = snapshot
			})
			tags.start()
			nativeActor = actor
			const subscription = actor.subscribe({
				next: (snapshot) => {
					if (draftIdentity === identity) nativeSnapshot = snapshot
				},
				error: () => {
					if (draftIdentity === identity) nativeError = true
				}
			})
			actor.start()
			return () => {
				if (tags.getSnapshot().status === 'active') tags.send({ type: 'SHUTDOWN' })
				tagSubscription.unsubscribe()
				if (tagActor === tags) {
					tagActor = undefined
					tagSnapshot = undefined
				}
				actor.send({ type: 'SHUTDOWN' })
				subscription.unsubscribe()
				if (nativeActor === actor) {
					nativeActor = undefined
					nativeSnapshot = undefined
				}
			}
		})
	})
	const textFields: readonly TransactionTextField[] = ['description', 'memo', 'checkNumber']
	function isTextField(name: string): name is TransactionTextField {
		return name === 'description' || name === 'memo' || name === 'checkNumber'
	}

	const accounts = $derived(
		view
			? [
					...new Map(
						[...view.accounts, ...(view.defaultAccount ? [view.defaultAccount] : [])].map((row) => [
							row.id,
							row
						])
					).values()
				]
			: []
	)
	const categories = $derived(
		view
			? [
					...new Map(
						[...view.categories, ...(view.defaultCategory ? [view.defaultCategory] : [])].map(
							(row) => [row.id, row]
						)
					).values()
				]
			: []
	)
	const patterns = $derived(new Map(accounts.map((row) => [row.id, row.amountPattern])))
	type Catalog = 'accounts' | 'categories' | 'tags'
	const catalogs = $derived<
		{ catalog: Catalog; page: PublicTransactionRouteView['accountPage']; subject: string }[]
	>(
		view
			? [
					{
						catalog: 'accounts',
						page: view.accountPage,
						subject: m['nouns.account']({ count: 2 })
					},
					{
						catalog: 'categories',
						page: view.categoryPage,
						subject: m['nouns.category']({ count: 2 })
					}
				]
			: []
	)
	const title = $derived(
		(view?.route && 'transactionId' in view.route
			? m['actions.edit_subject']
			: m['actions.add_subject'])({
			subject:
				view?.route?.kind === 'income'
					? m['nouns.income']({ count: 1 })
					: m['nouns.expense']({ count: 2 })
		})
	)
	function send(generation: number, formGeneration: number, command: TransactionRouteIntent) {
		if (workspace?.generation === generation && view?.generation === formGeneration)
			runtime.send({
				type: 'TRANSACTION_FORM',
				generation,
				formGeneration,
				draftRevision: view.form.draftRevision,
				command
			})
	}
	function captureDraft(form: HTMLFormElement): NativeFormDraft['values'] {
		const data = new FormData(form)
		const text = (name: string) => {
			const value = data.get(name)
			return typeof value === 'string' ? value : ''
		}
		const optional = (name: string) => (data.has(name) ? text(name) : undefined)
		const files = data.getAll('attachments').filter((value): value is File => value instanceof File)
		const retainedFields = view?.initialEntry
			? textFields.filter((field) => !changedFields.has(field))
			: undefined
		return {
			retainedFields,
			tagMode: view?.initialEntry ? 'append' : undefined,

			accountId: text('accountId'),
			categoryId: text('categoryId'),
			amount: text('amount'),
			bookedOn: text('bookedOn'),
			description: retainedFields?.includes('description') ? '' : text('description'),
			memo: retainedFields?.includes('memo') ? '' : text('memo'),
			tagComposer: true,
			paymentMethod: optional('paymentMethod'),
			checkId: optional('checkId'),
			checkNumber: retainedFields?.includes('checkNumber') ? '' : optional('checkNumber'),
			checkDate: optional('checkDate'),
			attachments: files.slice(0, 5),
			attachmentCount: files.length
		}
	}
	function dispatchDraft(
		type: 'SUBMIT' | 'CHANGE',
		values: NativeFormDraft['values'],
		tagPatch?: NewTagPatch
	) {
		nativeActor?.send({
			type: 'DRAFT',
			replaceable: type === 'CHANGE' && !values.tagEdit && !tagPatch,
			command: { type, values: { ...values, tagPatch } }
		})
	}
	function draft(
		form: HTMLFormElement,
		generation: number,
		formGeneration: number,
		type: 'SUBMIT' | 'CHANGE',
		tagEdit?: { id: string; selected: boolean },
		tagPatch?: NewTagPatch
	) {
		if (workspace?.generation !== generation || view?.generation !== formGeneration) return
		dispatchDraft(type, { ...captureDraft(form), tagEdit }, tagPatch)
	}
	function addTag(name: string, form: HTMLFormElement) {
		if (nativeStatus.busy || tagStatus.busy || !view?.form.fieldsEditable) return
		const values = captureDraft(form),
			identity = draftIdentity
		tagActor?.send({
			type: 'PREPARE',
			name,
			deliver: (name) => {
				if (draftIdentity === identity) dispatchDraft('CHANGE', values, { type: 'ADD', name })
			}
		})
	}
</script>

{#snippet emptyNavigation()}{/snippet}
{#if view?.mode === 'active' && view.route && workspace}
	{#key `${workspace.generation}:${view.generation}`}
		{@const generation = workspace.generation}
		{@const formGeneration = view.generation}
		<PageLayout {navigation}>
			{#snippet pageHeading()}<PageHeader {title} />{/snippet}
			{#if !transfer?.deleted}
				<FormFeedback
					view={view.form}
					subject={m['nouns.transaction']({ count: 1 })}
					reasonText={(reason) => formReasonText[reason]()}
					invalidMessage={m['forms.validation_error']()}
					section={view.form.readiness.kind === 'ready' ? 'readiness' : 'all'}
					onRetryReadiness={() => send(generation, formGeneration, { type: 'RETRY_READINESS' })}
				/>
			{/if}
			{#if nativeError}
				<FieldFeedback
					id="transaction-native-text-feedback"
					errorMessage={m['errors.operation_failed']()}
				/>
				<Button
					type="button"
					onclick={() => {
						nativeError = false
						nativeActor?.send({ type: 'RETRY' })
					}}>{m['actions.retry']()}</Button
				>
			{/if}
			{#if view.emptyAccounts}<WorkerAccountCreation {runtime} />{/if}
			{#if (!('transactionId' in view.route) || view.initialEntry) && !transfer?.deleted}
				<TransactionForm
					kind={view.route.kind}
					mode={view.initialEntry ? 'edit' : 'create'}
					initialTransaction={view.initialEntry ?? undefined}
					paymentEntry={view.route.kind === 'income' ? 'inline' : 'preserve'}
					organizationId={workspace.organizationId}
					{accounts}
					{categories}
					defaultAccountId={view.defaultAccountId ?? undefined}
					defaultCategoryId={view.defaultCategoryId ?? undefined}
					tagSuggestions={view.tagSuggestions}
					view={nativeFormView ?? view.form}
					presentation={{
						today: view.today,
						amountPatterns: patterns,
						initialAmount: view.initialAmount,
						nativeTextValues,
						readonlyFields: view.readonlyFields.filter(
							(field) => !isTextField(field) || nativeTextValues[field] === undefined
						)
					}}
					oncancel={() => navigate(view.cancelHref)}
					onsubmit={(event) => {
						event.preventDefault()
						if (event.currentTarget instanceof HTMLFormElement)
							draft(event.currentTarget, generation, formGeneration, 'SUBMIT')
					}}
					oninput={(event) => {
						if (!view.initialEntry || !(event.currentTarget instanceof HTMLFormElement)) return
						const field = event.target
						if (
							(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) &&
							isTextField(field.name)
						)
							changedFields = new Set([...changedFields, field.name])
						draft(event.currentTarget, generation, formGeneration, 'CHANGE')
					}}
					onreset={(event) => {
						event.preventDefault()
						send(generation, formGeneration, { type: 'RESET' })
					}}
					attachmentPickerRevision={view.form.draftRevision}
					{transferSuggestions}
					transferEditorState={transfer?.state ?? 'unselected'}
					transferSearchEnabled={transfer?.searchEnabled ?? false}
					transferConflict={transfer?.conflicted ?? false}
					selectedTransferCandidateId={transfer?.selectedCandidateId ?? null}
					writableTransferSuggestionIds={writableTransferIds}
					transferLinkPending={transfer?.linkPending ?? false}
					transferUnlinkAvailable={transfer?.unlinkAvailable ?? false}
					transferUnlinkWritable={transfer?.unlinkWritable ?? false}
					transferUnlinkPending={transfer?.unlinkPending ?? false}
					linkedCounterpartHref={transfer?.counterpartHref ?? null}
					transferStatusLabel={transfer?.statusText ? () => transfer?.statusText ?? '' : null}
					onTransferSearchEnabledChange={(enabled) =>
						edit(generation, formGeneration, {
							type: enabled ? 'ENABLE_SEARCH' : 'DISABLE_SEARCH'
						})}
					onSelectTransferCandidate={(candidateId) =>
						edit(generation, formGeneration, { type: 'SELECT_COUNTERPART', candidateId })}
					onLinkCounterpart={(candidateId) =>
						edit(generation, formGeneration, { type: 'LINK_COUNTERPART', candidateId })}
					onUnlinkTransfer={() => edit(generation, formGeneration, { type: 'UNLINK_TRANSFER' })}
					onOpenCounterpart={navigate}
				>
					{#snippet newTags()}
						<WorkerTransactionTags
							scope={draftIdentity}
							draft={view.newTags}
							choices={view.tagChoices}
							choicePage={view.tagPage}
							disabled={!view.form.fieldsEditable ||
								nativeStatus.busy ||
								tagStatus.busy ||
								nativeStatus.blocked}
							nativeFailed={tagStatus.failed}
							onadd={addTag}
							onpatch={(patch, form) =>
								draft(form, generation, formGeneration, 'CHANGE', undefined, patch)}
							onpage={(offset) => send(generation, formGeneration, { type: 'TAG_PAGE', offset })}
							onchoicespage={(offset) =>
								runtime.send({
									type: 'TRANSACTION_OPTIONS',
									generation,
									formGeneration,
									catalog: 'tags',
									offset
								})}
						/>
					{/snippet}
					{#snippet savedTags()}
						{#if view.initialEntry}
							<SavedTransactionTagSelection
								tags={view.savedTags}
								page={view.savedTagPage}
								disabled={!view.form.fieldsEditable || nativeStatus.busy || nativeStatus.blocked}
								onselect={(id, selected, form) => {
									if (form) draft(form, generation, formGeneration, 'CHANGE', { id, selected })
								}}
								onpage={(offset) =>
									runtime.send({
										type: 'TRANSACTION_OPTIONS',
										generation,
										formGeneration,
										catalog: 'savedTags',
										offset
									})}
							/>
						{/if}
					{/snippet}
				</TransactionForm>
			{/if}
			{#if transfer && view.route && 'transactionId' in view.route}
				<CatalogPager
					page={transfer.page}
					size={500}
					subject={m['nouns.transaction']({ count: 2 })}
					onpage={(offset) =>
						runtime.send({
							type: 'TRANSACTION_OPTIONS',
							generation,
							formGeneration,
							catalog: 'transfers',
							offset
						})}
				/>
				<InternalTransferDeleteActions
					transactionId={view.route.transactionId}
					available={transfer.canDelete}
					pending={transfer.deletePending}
					feedback={transfer.deleteFeedback
						? {
								label: () => transfer?.deleteFeedback?.text ?? '',
								variant: transfer.deleteFeedback.variant
							}
						: null}
					onDelete={(choice) =>
						edit(generation, formGeneration, { type: 'DELETE_LINKED_TRANSFER', choice })}
				/>
			{/if}

			{#each catalogs as item (item.catalog)}
				<CatalogPager
					page={item.page}
					size={500}
					subject={item.subject}
					onpage={(offset) => {
						runtime.send({
							type: 'TRANSACTION_OPTIONS',
							generation,
							formGeneration,
							catalog: item.catalog,
							offset
						})
					}}
				/>
			{/each}
		</PageLayout>
	{/key}
{/if}
