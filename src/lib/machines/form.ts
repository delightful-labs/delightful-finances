import { assign, fromPromise, setup, type SnapshotFrom } from 'xstate'
import type { z } from 'zod'

export type FormSave<Values, Result, Context> = (
	values: Values,
	options: { signal: AbortSignal; context: Context }
) => Promise<Result>

type FormContext<Values, Result> = {
	submitted: unknown
	validated: { value: Values } | null
	result: Result | undefined
	error: unknown
}

type FormEvent = { type: 'SUBMIT'; values: unknown } | { type: 'RESET' }

export function createFormMachine<Values, Result, Context>(
	schema: z.ZodType<Values>,
	persist: FormSave<Values, Result, Context>,
	context: Context
) {
	const validate = fromPromise<Values, unknown>(({ input }) => schema.parseAsync(input))
	const save = fromPromise<Result, { value: Values } | null>(({ input, signal }) => {
		if (input === null) throw new Error('Cannot save a form before validation succeeds.')
		return persist(input.value, { signal, context })
	})
	const form = setup<
		FormContext<Values, Result>,
		FormEvent,
		{ validate: typeof validate; save: typeof save }
	>({ actors: { validate, save } })
	const clear = form.assign({
		submitted: undefined,
		validated: null,
		result: undefined,
		error: null
	})
	const submit = {
		target: 'validating',
		actions: form.assign(({ event }) =>
			event.type === 'SUBMIT'
				? { submitted: event.values, validated: null, result: undefined, error: null }
				: {}
		)
	}
	const reset = { target: 'editing', actions: clear }

	return form.createMachine({
		id: 'form',
		initial: 'editing',
		context: { submitted: undefined, validated: null, result: undefined, error: null },
		states: {
			editing: { on: { SUBMIT: submit, RESET: reset } },
			validating: {
				tags: 'busy',
				invoke: {
					src: 'validate',
					input: ({ context }: { context: FormContext<Values, Result> }) => context.submitted,
					onDone: {
						target: 'saving',
						actions: assign(({ event }) => ({ validated: { value: event.output } }))
					},
					onError: {
						target: 'invalid',
						actions: assign(({ event }) => ({ error: event.error }))
					}
				}
			},
			invalid: { on: { SUBMIT: submit, RESET: reset } },
			saving: {
				tags: 'busy',
				invoke: {
					src: 'save',
					input: ({ context }) => context.validated,
					onDone: {
						target: 'success',
						actions: assign(({ event }) => ({ result: event.output }))
					},
					onError: {
						target: 'error',
						actions: assign(({ event }) => ({ error: event.error }))
					}
				}
			},
			success: { on: { SUBMIT: submit, RESET: reset } },
			error: { on: { SUBMIT: submit, RESET: reset } }
		}
	})
}

export type FormView<Values, Result, Context> = {
	state: SnapshotFrom<ReturnType<typeof createFormMachine<Values, Result, Context>>>
	busy: boolean
	disabled: boolean
	issues: readonly z.core.$ZodIssue[]
}
