<script lang="ts">
	import { untrack } from 'svelte'
	import { FieldFeedback } from 'delightful-ui'
	import { createActor, type ActorRefFrom, type SnapshotFrom } from 'xstate'
	import {
		nativeNameInputMachine,
		selectNativeNameInput
	} from '#lib/machines/runtime/native-name-input.js'
	import { fromStore } from 'svelte/store'
	import { getFinanceUiRuntime, type FinanceUiRuntime } from '#lib/runtime/finance-ui.js'
	import type { ManagementIntent } from '#lib/runtime/worker/management-protocol.js'
	import { m } from '#lib/paraglide/messages.js'
	import CategoryForm from './CategoryForm.svelte'
	import TagForm from './TagForm.svelte'
	import CategoryList from './CategoryList.svelte'
	import TagList from './TagList.svelte'
	import QueryContent from '../shared/QueryContent.svelte'
	import CatalogPager from '../navigation/CatalogPager.svelte'

	let {
		kind,
		runtime = getFinanceUiRuntime()
	}: { kind: 'categories' | 'tags'; runtime?: FinanceUiRuntime } = $props()
	const snapshotStore = $derived(fromStore(runtime.view))
	const workspace = $derived(snapshotStore.current?.workspace)
	const view = $derived(workspace?.management)
	const generation = $derived(workspace?.generation ?? 0)
	// Only adapt already-computed cells to the existing presentation API.
	const counts = $derived(
		new Map(
			view?.categories.map((row) => [
				row.id,
				{ transactions: row.transactionCount, tags: row.tagCount }
			])
		)
	)
	const categoryNames = $derived(
		new Map(
			view?.tags.flatMap((row) =>
				row.categoryId && row.categoryName !== null ? [[row.categoryId, row.categoryName]] : []
			)
		)
	)
	const categoryIds = $derived(
		view?.categories.flatMap((row) => (row.archivable ? [row.id] : [])) ?? []
	)
	const tagIds = $derived(view?.tags.flatMap((row) => (row.archivable ? [row.id] : [])) ?? [])
	const nameForm = $derived(kind === 'categories' ? 'category' : 'tag')
	const identity = $derived(`${generation}:${nameForm}:${view?.forms[nameForm].draftRevision}`)
	let nativeActor = $state.raw<ActorRefFrom<typeof nativeNameInputMachine>>()
	let nativeSnapshot = $state.raw<SnapshotFrom<typeof nativeNameInputMachine>>()
	const nativeStatus = $derived(selectNativeNameInput(nativeSnapshot))
	const nativeCategoryView = $derived(
		view
			? {
					...view.forms.category,
					canSubmit: view.forms.category.canSubmit && !nativeStatus.busy,
					canReset: view.forms.category.canReset && !nativeStatus.busy,
					fieldsEditable: view.forms.category.fieldsEditable && !nativeStatus.busy
				}
			: undefined
	)
	const nativeTagView = $derived(
		view
			? {
					...view.forms.tag,
					canSubmit: view.forms.tag.canSubmit && !nativeStatus.busy,
					canReset: view.forms.tag.canReset && !nativeStatus.busy,
					fieldsEditable: view.forms.tag.fieldsEditable && !nativeStatus.busy
				}
			: undefined
	)

	$effect(() => {
		const capturedIdentity = identity
		return untrack(() => {
			if (!workspace || !view) return
			const generation = workspace.generation,
				form = nameForm,
				draftRevision = view.forms[form].draftRevision
			const actor = createActor(nativeNameInputMachine, {
				input: {
					requestId: crypto.randomUUID(),
					exchange: (command, signal) =>
						runtime.exchangeText?.(
							{ type: 'NAME_TEXT', generation, form, draftRevision, command },
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
		intent: ManagementIntent,
		revision = workspace?.management.forms[intent.form].draftRevision
	) {
		if (
			generation > 0 &&
			workspace?.generation === generation &&
			revision === workspace.management.forms[intent.form].draftRevision
		)
			runtime.send({
				type: 'MANAGEMENT_FORM',
				generation,
				draftRevision: workspace.management.forms[intent.form].draftRevision,
				...intent
			})
	}
	function submit(event: SubmitEvent, generation: number, form: 'category' | 'tag') {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		const data = new FormData(event.currentTarget)
		const text = (name: string) => {
			const value = data.get(name)
			return typeof value === 'string' ? value : ''
		}
		const capturedIdentity = identity,
			revision = view?.forms[form].draftRevision
		const kind = text('kind'),
			categoryId = text('categoryId')
		nativeActor?.send({
			type: 'PREPARE',
			name: text('name'),
			deliver: (name) => {
				if (identity === capturedIdentity)
					send(
						generation,
						{
							form,
							command: {
								type: 'SUBMIT',
								values: { name, kind, ...(form === 'tag' ? { categoryId } : {}) }
							}
						},
						revision
					)
			}
		})
	}
</script>

{#if nativeStatus.failed}<FieldFeedback
		id={`${kind}-native-name-feedback`}
		errorMessage={m['errors.operation_failed']()}
	/>{/if}
{#if view && workspace}
	{#key generation}
		{@const displayedGeneration = generation}
		{@const organizationId = workspace.organizationId}
		<QueryContent
			keepContentWhileLoading={kind === 'categories'}
			queries={[
				{
					isLoading: kind === 'categories' ? view.loading : view.tagLoading,
					error: (kind === 'categories' ? view.failed : view.tagFailed) ? true : null
				}
			]}
			loadingMessage={m['status.loading_subject']({
				subject:
					kind === 'categories' ? m['nouns.category']({ count: 2 }) : m['nouns.tag']({ count: 2 })
			})}
			errorMessage={m['errors.load_subject']({
				subject:
					kind === 'categories' ? m['nouns.category']({ count: 2 }) : m['nouns.tag']({ count: 2 })
			})}
		>
			{#if organizationId}
				{#if kind === 'categories'}
					<CategoryList
						categories={view.categories}
						{counts}
						projected
						filter={view.categoryFilter}
						onFilter={(filter) =>
							runtime.send({
								type: 'MANAGEMENT_FILTER',
								generation: displayedGeneration,
								catalog: 'categories',
								filter
							})}
						archivableCategoryIds={categoryIds}
						archiveView={view.forms.categoryArchive}
						onArchive={(categoryId) =>
							send(displayedGeneration, {
								form: 'categoryArchive',
								command: { type: 'SUBMIT', values: { categoryId, organizationId } }
							})}
					/>
					<CatalogPager
						page={view.categoryPage}
						size={500}
						subject={m['nouns.category']({ count: 2 })}
						onpage={(offset) =>
							runtime.send({
								type: 'CATALOG_PAGE',
								generation: displayedGeneration,
								catalog: 'categories',
								offset
							})}
					/>
				{:else}
					<TagList
						tags={view.tags}
						{categoryNames}
						projected
						filter={view.tagFilter}
						showFilter={view.tagRecordCount > 0}
						onFilter={(filter) =>
							runtime.send({
								type: 'MANAGEMENT_FILTER',
								generation: displayedGeneration,
								catalog: 'tags',
								filter
							})}
						archivableTagIds={tagIds}
						archiveView={view.forms.tagArchive}
						onArchive={(tagId) =>
							send(displayedGeneration, {
								form: 'tagArchive',
								command: { type: 'SUBMIT', values: { tagId, organizationId } }
							})}
					/>
					<CatalogPager
						page={view.tagPage}
						size={500}
						subject={m['nouns.tag']({ count: 2 })}
						onpage={(offset) =>
							runtime.send({
								type: 'CATALOG_PAGE',
								generation: displayedGeneration,
								catalog: 'tags',
								offset
							})}
					/>
				{/if}
			{/if}
		</QueryContent>
		{#if kind === 'categories'}
			<CategoryForm
				scope={displayedGeneration}
				view={nativeCategoryView ?? view.forms.category}
				onopen={() => send(displayedGeneration, { form: 'category', command: { type: 'OPEN' } })}
				onsubmit={(event) => submit(event, displayedGeneration, 'category')}
				onreset={(event) => {
					event.preventDefault()
					send(displayedGeneration, { form: 'category', command: { type: 'RESET' } })
				}}
				onRetryReadiness={() =>
					send(displayedGeneration, { form: 'category', command: { type: 'RETRY_READINESS' } })}
			/>
		{:else}
			<TagForm
				scope={displayedGeneration}
				view={nativeTagView ?? view.forms.tag}
				categories={view.categoryOptions}
				categoriesProjected
				projectedKind={view.categoryOptionsKind}
				onKindChange={(kind) =>
					runtime.send({
						type: 'MANAGEMENT_OPTIONS',
						generation: displayedGeneration,
						kind,
						offset: 0
					})}
				onopen={() => {
					runtime.send({
						type: 'MANAGEMENT_OPTIONS',
						generation: displayedGeneration,
						kind: 'expense',
						offset: 0
					})
					send(displayedGeneration, { form: 'tag', command: { type: 'OPEN' } })
				}}
				onsubmit={(event) => submit(event, displayedGeneration, 'tag')}
				onreset={(event) => {
					event.preventDefault()
					runtime.send({
						type: 'MANAGEMENT_OPTIONS',
						generation: displayedGeneration,
						kind: 'expense',
						offset: 0
					})
					send(displayedGeneration, { form: 'tag', command: { type: 'RESET' } })
				}}
				onRetryReadiness={() =>
					send(displayedGeneration, { form: 'tag', command: { type: 'RETRY_READINESS' } })}
			>
				{#snippet categoryOptionsControls(kind)}
					{#if kind === view.categoryOptionsKind}
						<CatalogPager
							page={view.categoryOptionsPage}
							size={500}
							subject={m['nouns.category']({ count: 2 })}
							onpage={(offset) =>
								runtime.send({
									type: 'MANAGEMENT_OPTIONS',
									generation: displayedGeneration,
									kind: view.categoryOptionsKind,
									offset
								})}
						/>
					{/if}
				{/snippet}
			</TagForm>
		{/if}
	{/key}
{/if}
