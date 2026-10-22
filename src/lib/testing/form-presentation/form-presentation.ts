import { assign, fromPromise, setup } from 'xstate'
import { z } from 'zod'
import type {
	FormCapability,
	FormChildEvent,
	FormObservation,
	FormOperationInput,
	FormOperationResult
} from '../../form-contract.js'
import type { ScopedFormOptions } from '../../machines/scoped-form.js'

export type Facts = { scope: string; allowed: boolean }
type Values = { name: string }
type Result = FormOperationResult<void, string>

export function harnessOptions(controls: {
	observe: () => Facts
	validate?: () => Promise<void>
	start: () => Promise<Result>
	command: (event: FormChildEvent<Facts>) => void
}) {
	const availability = setup<
		{ observation: FormObservation<Facts> },
		FormChildEvent<Facts>,
		{},
		{},
		{},
		{},
		never,
		string,
		FormObservation<Facts>
	>({}).createMachine({
		context: ({ input }) => ({ observation: input }),
		on: { OBSERVE: { actions: assign({ observation: ({ event }) => event.observation }) } }
	})
	const settle = fromPromise<Result>(() => controls.start())
	const operation = setup<
		{ result: Result },
		FormChildEvent<Facts>,
		{ settle: typeof settle },
		{},
		{},
		{},
		never,
		string,
		FormOperationInput<Values, string, Facts>,
		Result
	>({ actors: { settle } }).createMachine({
		context: { result: { outcome: 'succeeded', value: undefined, settlement: 'locallyPersisted' } },
		initial: 'working',
		output: ({ context }) => context.result,
		states: {
			working: {
				invoke: {
					src: 'settle',
					onDone: { target: 'done', actions: assign({ result: ({ event }) => event.output }) }
				},
				on: {
					OBSERVE: { actions: ({ event }) => controls.command(event) },
					INVALIDATE: { actions: ({ event }) => controls.command(event) },
					CANCEL: { actions: ({ event }) => controls.command(event) },
					SHUTDOWN: { actions: ({ event }) => controls.command(event) }
				}
			},
			done: { type: 'final' }
		}
	})
	const fields = z.object({ name: z.string().trim().min(1) })
	const validate = controls.validate
	return {
		schema: validate
			? fields.superRefine(async () => {
					await validate()
				})
			: fields,
		availability,
		operation,
		selectAvailability: (
			snapshot: ReturnType<typeof availability.getInitialSnapshot>
		): FormCapability<string, string> => {
			const { revision, facts } = snapshot.context.observation
			return {
				revision,
				scope: facts.scope,
				readiness: facts.allowed ? { kind: 'ready' } : { kind: 'blocked', reason: 'readOnly' }
			}
		},
		scopeOf: (facts: Facts) => facts.scope,
		sameScope: (left: string, right: string) => left === right,
		observe: controls.observe
	} satisfies ScopedFormOptions<
		Values,
		void,
		string,
		string,
		Facts,
		ReturnType<typeof availability.getInitialSnapshot>,
		ReturnType<typeof operation.getInitialSnapshot>
	> & { observe: () => Facts }
}
