<script lang="ts" generics="View extends FormPresentation">
	import { Button, Dialog } from 'delightful-ui'
	import type { Snippet } from 'svelte'
	import type { FormPresentation } from '#lib/form-contract.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'
	import Icon from './AppIcon.svelte'
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
		trigger
	}: {
		scope: unknown
		label: string
		view: View
		onopen: () => void
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		fields: Snippet<[View]>
		feedback: Snippet<[View]>
		trigger?: Snippet<[() => void, boolean]> | undefined
	} = $props()

	const triggerDisabled = $derived(!view.canOpen)

	function openModal() {
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
		<span class="button-content"><Icon icon={AddIcon} />{label}</span>
	</Button>
{/if}

<Dialog heading={label} bind:open closedby="any">
	{#key scope}
		{#if view.content.kind === 'success'}
			{@render feedback(view)}
			<Button type="button" variant="primary" onclick={() => (open = false)}>
				<span class="button-content"><Icon icon={CloseIcon} />{m['actions.close']()}</span>
			</Button>
		{:else}
			<FormContent controlsFill {view} {onsubmit} {onreset} {fields} {feedback}>
				{#snippet controls(form)}
					<Button type="button" onclick={() => (open = false)}>
						<span class="button-content"
							><Icon icon={CloseIcon} />{form.activity.kind === 'idle'
								? m['actions.cancel']()
								: m['actions.close']()}</span
						>
					</Button>
					<Button type="submit" variant="primary" disabled={!form.canSubmit}>
						<span class="button-content"><Icon icon={SaveIcon} />{label}</span>
					</Button>
				{/snippet}
			</FormContent>
		{/if}
	{/key}
</Dialog>

<style>
	.button-content {
		display: inline-flex;
		align-items: center;
		gap: var(--dui-space-xs, 0.5rem);
	}
</style>
