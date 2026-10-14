<script lang="ts" generics="Values, Result, Context">
	import { untrack, type Snippet } from 'svelte'
	import { useMachine } from '@xstate/svelte'
	import { z } from 'zod'
	import { createFormMachine, type FormSave, type FormView } from '#lib/machines/form.js'

	let {
		schema,
		save,
		context,
		arrayFields = [],
		disabled = false,
		fields,
		controls,
		feedback
	}: {
		schema: z.ZodType<Values>
		save: FormSave<Values, Result, Context>
		context: Context
		arrayFields?: readonly string[]
		disabled?: boolean
		fields: Snippet<[FormView<Values, Result, Context>]>
		controls?: Snippet<[FormView<Values, Result, Context>]>
		feedback?: Snippet<[FormView<Values, Result, Context>]>
	} = $props()

	// One actor per mounted form. Key the component when switching records.
	const machine = untrack(() => createFormMachine(schema, save, context))
	const { snapshot, send } = useMachine(machine)
	const busy = $derived($snapshot.hasTag('busy'))
	const view: FormView<Values, Result, Context> = $derived({
		state: $snapshot,
		busy,
		disabled: disabled || busy,
		issues: $snapshot.context.error instanceof z.ZodError ? $snapshot.context.error.issues : []
	})

	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (disabled || !(event.currentTarget instanceof HTMLFormElement)) return
		const data = new FormData(event.currentTarget)
		const values = Object.fromEntries(data)
		const arrays = Object.fromEntries(arrayFields.map((name) => [name, data.getAll(name)]))
		send({ type: 'SUBMIT', values: { ...values, ...arrays } })
	}

	function reset(event: Event) {
		if (disabled || busy) {
			event.preventDefault()
			return
		}
		send({ type: 'RESET' })
	}
</script>

<form onsubmit={submit} onreset={reset} aria-busy={busy}>
	<div class="form-fields">{@render fields(view)}</div>
	{#if controls}
		<div class="form-controls">{@render controls(view)}</div>
	{/if}
	<!-- Future field feedback: docs/delightful-ui-integration.md#field-feedback -->
	{#if feedback}
		<div class="form-feedback">{@render feedback(view)}</div>
	{/if}
</form>

<style>
	form {
		display: grid;
		gap: var(--dui-space-sm, 1rem);
	}

	.form-fields,
	.form-feedback {
		display: grid;
		gap: var(--dui-space-xs, 0.5rem);
		min-width: 0;
	}

	.form-controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-space-xs, 0.5rem);
	}

	.form-fields:empty,
	.form-controls:empty,
	.form-feedback:empty {
		display: none;
	}

	form :global(p) {
		margin: 0;
	}
</style>
