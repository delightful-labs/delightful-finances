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
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		fields: Snippet<[FormView<Values, Result, Context>]>
		feedback: Snippet<[FormView<Values, Result, Context>]>
		trigger?: Snippet<[() => void, boolean]> | undefined
	} = $props()

	let open = $state(false)
	$effect(() => {
		void scope
		open = false
	})
</script>

{#if trigger}
	{@render trigger(() => (open = true), disabled)}
{:else}
	<Button type="button" {disabled} onclick={() => (open = true)}>
		<span class="button-content"><Icon icon={AddIcon} />{label}</span>
	</Button>
{/if}

<Dialog heading={label} bind:open closedby="any">
	{#key scope}
		<FormContent controlsFill {view} {onsubmit} {onreset} {fields} {feedback}>
			{#snippet controls(form)}
				<Button type="button" onclick={() => (open = false)}>
					<span class="button-content"><Icon icon={CloseIcon} />{m['actions.cancel']()}</span>
				</Button>
				{#if form.state.matches('success')}
					<Button type="reset" variant="primary" {disabled}>
						<span class="button-content"><Icon icon={SaveIcon} />{label}</span>
					</Button>
				{:else}
					<Button type="submit" variant="primary" disabled={form.disabled}>
						<span class="button-content"
							><Icon icon={SaveIcon} />{form.busy ? savingLabel : label}</span
						>
					</Button>
				{/if}
			{/snippet}
		</FormContent>
	{/key}
</Dialog>

<style>
	.button-content {
		display: inline-flex;
		align-items: center;
		gap: var(--dui-space-xs, 0.5rem);
	}
</style>
