import { onMount, untrack } from 'svelte'
import { createActor, type Snapshot } from 'xstate'
import type { z } from 'zod'
import { createFormMachine, selectLegacyFormView, type FormSave } from '#lib/machines/form.js'
import {
	createScopedFormMachine,
	selectScopedFormView,
	type ScopedFormOptions
} from '#lib/machines/scoped-form.js'
import type { FormOperationResult } from '#lib/form-contract.js'

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
	const view = $derived(selectLegacyFormView<Values, Result, Context>(state, disabled))

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
	function open() {
		actor.send({ type: 'OPEN' })
	}
	return {
		open,
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

/** Additive path: each integration owns one exact dependency binding until shutdown settles. */
export function createScopedFormController<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	AvailabilitySnapshot extends Snapshot<unknown>,
	OperationSnapshot extends Snapshot<FormOperationResult<Result, Reason>>
>(
	options: ScopedFormOptions<
		Values,
		Result,
		Reason,
		Scope,
		Observation,
		AvailabilitySnapshot,
		OperationSnapshot
	> & {
		observe: () => Observation
		arrayFields?: () => readonly string[]
	}
) {
	const bound = untrack(() => options)
	const actor = untrack(() =>
		createActor(
			createScopedFormMachine<
				Values,
				Result,
				Reason,
				Scope,
				Observation,
				AvailabilitySnapshot,
				OperationSnapshot
			>(bound),
			{ input: bound.observe() }
		)
	)
	let formSnapshot = $state.raw(actor.getSnapshot())
	const view = $derived(
		selectScopedFormView<
			Values,
			Result,
			Reason,
			Scope,
			Observation,
			AvailabilitySnapshot,
			OperationSnapshot
		>(formSnapshot, bound)
	)
	$effect(() => {
		const observation = bound.observe()
		untrack(() => actor.send({ type: 'OBSERVE', observation }))
	})
	onMount(() => {
		const subscription = actor.subscribe({
			next: (snapshot) => {
				formSnapshot = snapshot
			},
			error: () => {
				formSnapshot = actor.getSnapshot()
			}
		})
		actor.start()
		return () => {
			subscription.unsubscribe()
			if (actor.getSnapshot().status !== 'active') {
				actor.stop()
				return
			}
			const completion = actor.subscribe({
				complete: () => actor.stop(),
				error: () => actor.stop()
			})
			actor.send({ type: 'SHUTDOWN' })
			if (actor.getSnapshot().status === 'done') {
				completion.unsubscribe()
				actor.stop()
			}
		}
	})
	function formValues(form: HTMLFormElement) {
		const data = new FormData(form)
		const arrays = Object.fromEntries(
			(bound.arrayFields?.() ?? []).map((name) => [name, data.getAll(name)])
		)
		return { ...Object.fromEntries(data), ...arrays }
	}
	function submitValues(values: unknown) {
		actor.send({ type: 'OBSERVE', observation: bound.observe() })
		actor.send({ type: 'SUBMIT', values })
	}
	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		submitValues(formValues(event.currentTarget))
	}
	function input(event: Event) {
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		actor.send({ type: 'OBSERVE', observation: bound.observe() })
		actor.send({ type: 'CHANGE', values: formValues(event.currentTarget) })
	}
	function reset(event: Event) {
		event.preventDefault()
		// Presentation keys fields by draftRevision; rejected RESET must leave native fields intact.
		actor.send({ type: 'RESET' })
	}
	return {
		input,
		submitValues,
		submit,
		reset,
		open: () => actor.send({ type: 'OPEN' }),
		cancel: () => actor.send({ type: 'CANCEL' }),
		retryReadiness: () => actor.send({ type: 'RETRY_READINESS' }),
		get view() {
			return view
		}
	}
}
