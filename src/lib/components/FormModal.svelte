<script lang="ts" generics="Values, Result, Context">
	import { Button, Dialog } from 'delightful-ui'
	import type { Snippet } from 'svelte'
	import type { FormView } from '#lib/machines/form.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from './FormContent.svelte'
	import Icon from './AppIcon.svelte'
	import AddIcon from 'tdesign-icons-svg/src/add.svg?component'
	import SaveIcon from 'tdesign-icons-svg/src/save.svg?component'
	import CloseIcon from 'tdesign-icons-svg/src/close.svg?component'

	let {
		scope,
		label,
		savingLabel,
		disabled = false,
		view,
		onopen,
		onsubmit,
		onreset,
		fields,
		feedback,
		trigger
	}: {
		scope: string | null
		label: string
		savingLabel: string
		disabled?: boolean
		view: FormView<Values, Result, Context>
		onopen: () => void
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		fields: Snippet<[FormView<Values, Result, Context>]>
		feedback: Snippet<[FormView<Values, Result, Context>]>
		trigger?: Snippet<[() => void, boolean]> | undefined
	} = $props()

	function openModal() {
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
	{@render trigger(openModal, disabled)}
{:else}
	<Button type="button" {disabled} onclick={openModal}>
		<span class="button-content"><Icon icon={AddIcon} />{label}</span>
	</Button>
{/if}

<Dialog heading={label} bind:open closedby="any">
	{#key scope}
		{#if view.state.matches('success')}
			{@render feedback(view)}
			<Button type="button" variant="primary" onclick={() => (open = false)}>
				<span class="button-content"><Icon icon={CloseIcon} />{m['actions.close']()}</span>
			</Button>
		{:else}
			<FormContent controlsFill {view} {onsubmit} {onreset} {fields} {feedback}>
				{#snippet controls(form)}
					<Button type="button" onclick={() => (open = false)}>
						<span class="button-content"><Icon icon={CloseIcon} />{m['actions.cancel']()}</span>
					</Button>
					<Button type="submit" variant="primary" disabled={form.disabled}>
						<span class="button-content"
							><Icon icon={SaveIcon} />{form.busy ? savingLabel : label}</span
						>
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
