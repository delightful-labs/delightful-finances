<script lang="ts">
	import { untrack } from 'svelte'
	import { InputText, Select, Button, FieldFeedback } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	import type { PublicTransactionRouteView } from '#lib/runtime/worker/transaction-route-protocol.js'
	import type { NewTagPatch } from '#lib/contracts/transaction-new-tag-contract.js'
	import CatalogPager from '../navigation/CatalogPager.svelte'
	let {
		scope,
		draft,
		choices,
		choicePage,
		disabled,
		nativeFailed,
		onadd,
		onpatch,
		onpage,
		onchoicespage
	}: {
		scope: string
		draft: PublicTransactionRouteView['newTags']
		choices: PublicTransactionRouteView['tagChoices']
		choicePage: PublicTransactionRouteView['tagPage']
		disabled: boolean
		nativeFailed: boolean
		onadd: (name: string, form: HTMLFormElement) => void
		onpatch: (patch: NewTagPatch, form: HTMLFormElement) => void
		onpage: (offset: number) => void
		onchoicespage: (offset: number) => void
	} = $props()
	let name = $state(''),
		selected = $state('')
	const inputRevision = $derived(draft.inputRevision)
	const choiceOffset = $derived(choicePage.offset)
	$effect(() => {
		void choiceOffset
		untrack(() => {
			selected = ''
		})
	})
	$effect(() => {
		void scope
		void inputRevision
		untrack(() => {
			name = ''
			selected = ''
		})
	})
</script>

<div>
	<InputText
		id="transaction-new-tag-name"
		label={m['nouns.tag']({ count: 2 })}
		bind:value={name}
		{disabled}
		oninput={(event) => event.stopPropagation()}
		onkeydown={(event) => {
			if (event.key === 'Enter') {
				event.preventDefault()
				if (!disabled && event.currentTarget.form) onadd(name, event.currentTarget.form)
			}
		}}
	/>
	<Button
		type="button"
		{disabled}
		onclick={(event) => {
			if (event.currentTarget.form) onadd(name, event.currentTarget.form)
		}}>{m['actions.add_subject']({ subject: m['nouns.tag']({ count: 1 }) })}</Button
	>
	{#if choices.length}
		<Select
			id="transaction-existing-tag"
			label={m['actions.select_subject']({ subject: m['nouns.tag']({ count: 1 }) })}
			bind:value={selected}
			{disabled}
			oninput={(event) => event.stopPropagation()}
		>
			<option value=""
				>{m['actions.select_subject']({ subject: m['nouns.tag']({ count: 1 }) })}</option
			>
			{#each choices as choice (choice.id)}<option value={choice.id}>{choice.name}</option>{/each}
		</Select>
		<Button
			type="button"
			disabled={disabled || !selected}
			onclick={(event) => {
				if (event.currentTarget.form)
					onpatch({ type: 'SELECT', tagId: selected }, event.currentTarget.form)
			}}>{m['actions.select_subject']({ subject: m['nouns.tag']({ count: 1 }) })}</Button
		>
	{/if}
	<CatalogPager
		page={choicePage}
		size={500}
		subject={m['nouns.tag']({ count: 2 })}
		onpage={onchoicespage}
	/>
	{#if draft.feedback || nativeFailed}<FieldFeedback
			id="transaction-tag-feedback"
			errorMessage={draft.feedback ?? m['errors.operation_failed']()}
		/>{/if}
	{#if draft.items.length}
		<ul aria-label={m['labels.selected_subjects']({ subjects: m['nouns.tag']({ count: 2 }) })}>
			{#each draft.items as item (item.id)}
				<li>
					{item.name}<Button
						type="button"
						{disabled}
						onclick={(event) => {
							if (event.currentTarget.form)
								onpatch({ type: 'REMOVE', id: item.id }, event.currentTarget.form)
						}}>{m['actions.remove_name']({ name: item.name })}</Button
					>
				</li>
			{/each}
		</ul>
	{/if}
	<CatalogPager page={draft.page} size={500} subject={m['nouns.tag']({ count: 2 })} {onpage} />
</div>
