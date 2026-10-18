import { afterEach, vi } from 'vitest'
import { assign, createActor, fromPromise, setup, waitFor } from 'xstate'
import { z } from 'zod'
import type {
	FormCapability,
	FormChildEvent,
	FormObservation,
	FormOperationInput,
	FormOperationResult
} from '#lib/form-contract.js'
import { createScopedFormMachine, selectScopedFormView } from './scoped-form.js'

export type Facts = { scope: string; allowed: boolean; publish?: boolean; broken?: boolean }
type Values = { name: string }
type Result = FormOperationResult<void, string>
export const schema = z.object({ name: z.string().trim().min(1) })
export const ready: Facts = { scope: 'workspace-a', allowed: true }
export const success: Result = {
	outcome: 'succeeded',
	value: undefined,
	settlement: 'locallyPersisted'
}
const cleanup: (() => void)[] = []
afterEach(() => {
	cleanup.splice(0).forEach((stop) => stop())
})

export function fixture(options: { schema?: z.ZodType<Values>; retain?: boolean } = {}) {
	const received = vi.fn<(event: FormChildEvent<Facts>) => void>()
	const started = vi.fn<(input: FormOperationInput<Values, string, Facts>) => void>()
	const availability = setup<
		{ observation: FormObservation<Facts>; capability: FormCapability<string, string> },
		FormChildEvent<Facts>,
		{},
		{},
		{},
		{},
		never,
		string,
		FormObservation<Facts>
	>({}).createMachine({
		context: ({ input }) => ({ observation: input, capability: capability(input) }),
		on: {
			OBSERVE: {
				actions: assign(({ context, event }) => ({
					observation: event.observation,
					capability:
						event.observation.facts.publish === false
							? context.capability
							: capability(event.observation)
				}))
			}
		}
	})
	const settlement = Promise.withResolvers<Result>()
	const aborted = vi.fn()
	const settle = fromPromise<Result>(({ signal }) => {
		signal.addEventListener('abort', aborted)
		return settlement.promise
	})
	const operation = setup<
		{ input: FormOperationInput<Values, string, Facts>; result: Result },
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
		context: ({ input }) => ({ input, result: success }),
		initial: 'working',
		entry: ({ context }) => started(context.input),
		output: ({ context }) => context.result,
		states: {
			working: {
				invoke: {
					src: 'settle',
					onDone: { target: 'done', actions: assign({ result: ({ event }) => event.output }) }
				},
				on: {
					OBSERVE: { actions: ({ event }) => received(event) },
					INVALIDATE: { actions: ({ event }) => received(event) },
					CANCEL: { actions: ({ event }) => received(event) },
					SHUTDOWN: { actions: ({ event }) => received(event) }
				}
			},
			done: { type: 'final' }
		}
	})
	const config = {
		schema: options.schema ?? schema,
		availability,
		operation,
		selectAvailability: (snapshot: ReturnType<typeof availability.getInitialSnapshot>) => {
			if (snapshot.context.observation.facts.broken) throw new Error('projection failed')
			return snapshot.context.capability
		},
		scopeOf: (facts: Facts) => facts.scope,
		sameScope: (left: string, right: string) => left === right,
		successContent: options.retain ? 'retain' : 'replace'
	} satisfies Parameters<
		typeof createScopedFormMachine<
			Values,
			void,
			string,
			string,
			Facts,
			ReturnType<typeof availability.getInitialSnapshot>,
			ReturnType<typeof operation.getInitialSnapshot>
		>
	>[0]
	const actor = createActor(
		createScopedFormMachine<
			Values,
			void,
			string,
			string,
			Facts,
			ReturnType<typeof availability.getInitialSnapshot>,
			ReturnType<typeof operation.getInitialSnapshot>
		>(config),
		{ input: ready }
	).start()
	cleanup.push(() => actor.stop())
	const view = () =>
		selectScopedFormView<
			Values,
			void,
			string,
			string,
			Facts,
			ReturnType<typeof availability.getInitialSnapshot>,
			ReturnType<typeof operation.getInitialSnapshot>
		>(actor.getSnapshot(), config)
	const submit = () => actor.send({ type: 'SUBMIT', values: { name: ' Home ' } })
	const working = async () => {
		await waitFor(actor, () => started.mock.calls.length > 0)
		const submission = actor.getSnapshot().children.submission
		const child = submission?.getSnapshot().children.operation
		if (!child) throw new Error('Operation did not start')
		return {
			send: (event: { type: 'SETTLE'; result: Result } | { type: 'CRASH' }) => {
				if (event.type === 'SETTLE') settlement.resolve(event.result)
				else settlement.reject(new Error('operation failed'))
			}
		}
	}
	const idle = () => waitFor(actor, (snapshot) => snapshot.matches({ open: { workflow: 'idle' } }))
	return { actor, view, submit, working, idle, received, started, config, settlement, aborted }
}
function capability(observation: FormObservation<Facts>): FormCapability<string, string> {
	return {
		revision: observation.revision,
		scope: observation.facts.scope,
		readiness: observation.facts.allowed
			? { kind: 'ready' }
			: { kind: 'blocked', reason: 'readOnly' }
	}
}
