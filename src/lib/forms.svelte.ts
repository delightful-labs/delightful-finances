import { untrack } from 'svelte'
import { createActor } from 'xstate'
import { z } from 'zod'
import { createFormMachine, type FormSave, type FormView } from '#lib/machines/form.js'

export function createFormController<Values, Result, Context>(options: {
	schema: z.ZodType<Values>
	save: FormSave<Values, Result, Context>
	context: () => Context
	key?: () => unknown
	disabled?: () => boolean
	arrayFields?: () => readonly string[]
}) {
	const makeActor = () =>
		createActor(createFormMachine(options.schema, options.save, options.context()))
	let actor = untrack(makeActor)
	let state = $state.raw(actor.getSnapshot())
	const key = $derived(options.key?.())
	const disabled = $derived(options.disabled?.() ?? false)
	const busy = $derived(state.hasTag('busy'))
	const view: FormView<Values, Result, Context> = $derived({
		state,
		busy,
		disabled: disabled || busy,
		issues: state.context.error instanceof z.ZodError ? state.context.error.issues : []
	})

	// Recreate only when the record/workspace key changes. Stop invokes and
	// unsubscribe on key changes and when the owning page unmounts.
	$effect(() => {
		void key
		const next = untrack(makeActor)
		actor = next
		state = next.getSnapshot()
		const subscription = next.subscribe((snapshot) => {
			state = snapshot
		})
		next.start()
		return () => {
			subscription.unsubscribe()
			next.stop()
		}
	})

	function submitValues(values: unknown) {
		if (disabled || busy) return
		actor.send({ type: 'SUBMIT', values })
	}
	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (disabled || busy || !(event.currentTarget instanceof HTMLFormElement)) return
		const data = new FormData(event.currentTarget)
		const values = Object.fromEntries(data)
		const arrays = Object.fromEntries(
			(options.arrayFields?.() ?? []).map((name) => [name, data.getAll(name)])
		)
		submitValues({ ...values, ...arrays })
	}
	function reset(event: Event) {
		if (disabled || busy) {
			event.preventDefault()
			return
		}
		actor.send({ type: 'RESET' })
	}
	return {
		submitValues,
		submit,
		reset,
		get view() {
			return view
		}
	}
}

export type FormController<Values, Result, Context> = ReturnType<
	typeof createFormController<Values, Result, Context>
>
