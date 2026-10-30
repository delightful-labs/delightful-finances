<script lang="ts" generics="View extends FormPresentation">
	import { Button, ButtonContent, Dialog } from 'delightful-ui'
	import type { Snippet } from 'svelte'
	import type { FormPresentation } from '#lib/form-contract.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'
	import AddIcon from 'tdesign-icons-svg/src/add.svg?component'
	import SaveIcon from 'tdesign-icons-svg/src/save.svg?component'
	import CloseIcon from 'tdesign-icons-svg/src/close.svg?component'

	let {
		scope,
		label,
		view,
		onopen,
		onsubmit,
		onreset,
		fields,
		feedback,
		trigger,
		announcements
	}: {
		scope: unknown
		label: string
		view: View
		onopen: () => void
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		fields: Snippet<[View]>
		feedback: Snippet<[View]>
		announcements?: Snippet<[View]> | undefined
		trigger?: Snippet<[() => void, boolean]> | undefined
	} = $props()

	const triggerDisabled = $derived(!view.canOpen)

	export function openModal() {
		if (triggerDisabled) return
		onopen()
		open = true
	}

	let open = $state(false)
	$effect(() => {
		void scope
		open = false
	})
</script>

{#if trigger}
	{@render trigger(openModal, triggerDisabled)}
{:else}
	<Button type="button" disabled={triggerDisabled} onclick={openModal}>
		<ButtonContent icon={AddIcon} text={label} />
	</Button>
{/if}

<Dialog heading={label} bind:open closedby="any">
	{@render announcements?.(view)}
	{#key scope}
		{#if view.content.kind === 'success'}
			{@render feedback(view)}
			<Button type="button" variant="primary" onclick={() => (open = false)}>
				<ButtonContent icon={CloseIcon} text={m['actions.close']()} />
			</Button>
		{:else}
			<FormContent controlsFill {view} {onsubmit} {onreset} {fields} {feedback}>
				{#snippet controls(form)}
					<Button type="button" onclick={() => (open = false)}>
						<ButtonContent
							icon={CloseIcon}
							text={form.activity.kind === 'idle' ? m['actions.cancel']() : m['actions.close']()}
						/>
					</Button>
					<Button
						type="submit"
						variant="primary"
						disabled={!form.canSubmit}
						aria-busy={form.activity.kind !== 'idle'}
					>
						<ButtonContent icon={SaveIcon} text={label} loading={form.activity.kind !== 'idle'} />
					</Button>
				{/snippet}
			</FormContent>
		{/if}
	{/key}
</Dialog>
