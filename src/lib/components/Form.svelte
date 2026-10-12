<script lang="ts" generics="Values, Result, Context">
	import { untrack, type Snippet } from 'svelte'
	import { useMachine } from '@xstate/svelte'
	import { z } from 'zod'
	import { createFormMachine, type FormSave, type FormView } from '#lib/machines/form.js'

	let {
		schema,
		save,
		context,
		disabled = false,
		fields,
		controls,
		feedback
	}: {
		schema: z.ZodType<Values>
		save: FormSave<Values, Result, Context>
		context: Context
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
		send({ type: 'SUBMIT', values: Object.fromEntries(new FormData(event.currentTarget)) })
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
	{@render fields(view)}
	{@render controls?.(view)}
	{@render feedback?.(view)}
</form>
