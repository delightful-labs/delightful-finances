import { assign, fromPromise, setup, stateIn, type ActorLogic, type Snapshot } from 'xstate'
import type {
	FormCapability,
	FormChildEvent,
	FormInterruption,
	FormObservation,
	FormOperationInput,
	FormOperationResult
} from '#lib/form-contract.js'

/** One effect only. Domain decisions belong in the supplied assessment actor. */
export function createScopedFormWriteMachine<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	AvailabilitySnapshot extends Snapshot<unknown>
>(options: {
	availability: ActorLogic<
		AvailabilitySnapshot,
		FormChildEvent<Observation>,
		FormObservation<Observation>
	>
	selectAvailability: (snapshot: AvailabilitySnapshot) => FormCapability<Scope, Reason>
	scopeOf: (facts: Observation) => Scope
	sameScope: (left: Scope, right: Scope) => boolean
	observe: () => Observation
	classifyBlocked: (reason: Reason) => 'denied' | 'unavailable'
	write: (input: FormOperationInput<Values, Scope, Observation>) => Promise<Result>
	settlement: 'locallyPersisted' | 'confirmed'
}) {
	type Input = FormOperationInput<Values, Scope, Observation>
	type Output = FormOperationResult<Result, Reason>
	type Context = {
		request: Input['request'] | undefined
		observation: FormObservation<Observation> | undefined
		capability: FormCapability<Scope, Reason> | undefined
		result: Output | undefined
	}
	type Event = FormChildEvent<Observation>
	const review = setup<
		{
			observation: FormObservation<Observation>
			capability: FormCapability<Scope, Reason> | undefined
		},
		FormChildEvent<Observation>,
		{ source: typeof options.availability },
		{},
		{},
		{},
		never,
		string,
		FormObservation<Observation>
	>({ actors: { source: options.availability } }).createMachine({
		context: ({ input }) => ({ observation: input, capability: undefined }),
		initial: 'watching',
		states: {
			watching: {
				invoke: {
					src: 'source',
					input: ({ context }) => context.observation,
					onSnapshot: {
						guard: ({ event }) => event.snapshot.status === 'active',
						actions: assign({
							capability: ({ event }) => options.selectAvailability(event.snapshot)
						})
					},
					onError: 'failed',
					onDone: 'failed'
				}
			},
			failed: { type: 'final' }
		}
	})
	const actors = {
		refresh: fromPromise<FormObservation<Observation>, FormObservation<Observation>>(
			async ({ input }) => ({ revision: input.revision, facts: options.observe() })
		),
		review,
		write: fromPromise<Result, Input>(({ input }) => options.write(input))
	}
	const form = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{
			closing: undefined
			invalidated: undefined
			cancelling: undefined
		},
		never,
		string,
		Input,
		Output
	>({
		actors,
		guards: {
			closing: stateIn({ writing: 'closing' }),
			invalidated: stateIn({ writing: 'invalidated' }),
			cancelling: stateIn({ writing: 'cancelling' })
		}
	})
	function observation(context: Context) {
		if (!context.observation) throw new Error('Missing write observation')
		return context.observation
	}
	function request(context: Context) {
		if (!context.request) throw new Error('Missing write request')
		return context.request
	}
	const observe = form.assign({
		observation: ({ context, event }) =>
			event.type === 'OBSERVE' ? event.observation : context.observation
	})
	const clear = form.assign({ request: undefined, observation: undefined, capability: undefined })
	const interrupted = (outcome: FormInterruption) =>
		form.createStateConfig({
			type: 'final',
			entry: [
				form.assign({
					result: ({ context }) => context.result ?? { outcome, settlement: 'notStarted' }
				}),
				clear
			]
		})
	const blocked = (outcome: 'denied' | 'unavailable') =>
		form.createStateConfig({
			type: 'final',
			entry: [
				form.assign({
					result: ({ context }): Output => {
						const readiness = context.capability?.readiness
						if (readiness?.kind !== 'blocked') throw new Error('Missing write capability')
						return { outcome, reason: readiness.reason, settlement: 'notStarted' }
					}
				}),
				clear
			]
		})
	function success(outcome: FormInterruption | 'succeeded', value: Result): Output {
		return outcome === 'succeeded'
			? { outcome, value, settlement: options.settlement }
			: { outcome, settlement: options.settlement }
	}
	function failure(outcome: FormInterruption | 'failed'): Output {
		return outcome === 'failed'
			? { outcome, code: 'operationFailed', settlement: 'unknown' }
			: { outcome, settlement: 'unknown' }
	}
	const prewriteFailure: Output = {
		outcome: 'failed',
		code: 'operationFailed',
		settlement: 'notStarted'
	}
	return form.createMachine({
		id: 'scoped-form-write',
		initial: 'refreshing',
		context: ({ input }) => ({
			request: input.request,
			observation: input.observation,
			capability: undefined,
			result: undefined
		}),
		output: ({ context }) => {
			if (!context.result) throw new Error('Missing write result')
			return context.result
		},
		on: { CANCEL: '.cancelled', INVALIDATE: '.scopeChanged', SHUTDOWN: '.closed' },
		states: {
			refreshing: {
				invoke: {
					src: 'refresh',
					input: ({ context }) => observation(context),
					onDone: {
						target: 'checkingScope',
						actions: assign({
							observation: ({ context, event }) =>
								event.output.revision === observation(context).revision
									? event.output
									: context.observation
						})
					},
					onError: { target: 'failed', actions: assign({ result: () => prewriteFailure }) }
				},
				on: { OBSERVE: { actions: observe } }
			},
			checkingScope: {
				always: [
					{
						guard: ({ context }) =>
							!options.sameScope(
								request(context).scope,
								options.scopeOf(observation(context).facts)
							),
						target: 'scopeChanged'
					},
					{ target: 'authorizing' }
				]
			},
			authorizing: {
				invoke: {
					src: 'review',
					input: ({ context }) => observation(context),
					onSnapshot: {
						guard: ({ context, event }) => {
							const capability = event.snapshot.context.capability
							return (
								event.snapshot.status === 'active' &&
								capability !== undefined &&
								capability.revision === observation(context).revision &&
								options.sameScope(capability.scope, request(context).scope)
							)
						},
						target: 'deciding',
						actions: assign({ capability: ({ event }) => event.snapshot.context.capability })
					},
					onError: { target: 'failed', actions: assign({ result: () => prewriteFailure }) },
					onDone: { target: 'failed', actions: assign({ result: () => prewriteFailure }) }
				},
				on: { OBSERVE: { target: 'checkingScope', actions: observe } }
			},
			deciding: {
				always: [
					{
						guard: ({ context }) => context.capability?.readiness.kind === 'ready',
						target: 'writing'
					},
					{
						guard: ({ context }) => {
							const readiness = context.capability?.readiness
							return (
								readiness?.kind === 'blocked' &&
								options.classifyBlocked(readiness.reason) === 'denied'
							)
						},
						target: 'denied'
					},
					{ target: 'unavailable' }
				]
			},
			writing: {
				initial: 'pending',
				invoke: {
					id: 'write',
					src: 'write',
					input: ({ context }) => ({
						request: request(context),
						observation: observation(context)
					}),
					onDone: [
						{
							guard: 'closing',
							target: 'closed',
							actions: assign({ result: ({ event }) => success('closed', event.output) })
						},
						{
							guard: 'invalidated',
							target: 'scopeChanged',
							actions: assign({ result: ({ event }) => success('scopeChanged', event.output) })
						},
						{
							guard: 'cancelling',
							target: 'cancelled',
							actions: assign({ result: ({ event }) => success('cancelled', event.output) })
						},
						{
							target: 'succeeded',
							actions: assign({ result: ({ event }) => success('succeeded', event.output) })
						}
					],
					onError: [
						{
							guard: 'closing',
							target: 'closed',
							actions: assign({ result: () => failure('closed') })
						},
						{
							guard: 'invalidated',
							target: 'scopeChanged',
							actions: assign({ result: () => failure('scopeChanged') })
						},
						{
							guard: 'cancelling',
							target: 'cancelled',
							actions: assign({ result: () => failure('cancelled') })
						},
						{ target: 'failed', actions: assign({ result: () => failure('failed') }) }
					]
				},
				on: {
					CANCEL: '.cancelling',
					INVALIDATE: '.invalidated',
					SHUTDOWN: '.closing',
					OBSERVE: [
						{
							guard: ({ context, event }) =>
								!options.sameScope(
									request(context).scope,
									options.scopeOf(event.observation.facts)
								),
							target: '.invalidated',
							actions: observe
						},
						{ actions: observe }
					]
				},
				states: {
					pending: {},
					cancelling: { on: { CANCEL: {} } },
					invalidated: { on: { CANCEL: {}, INVALIDATE: {} } },
					closing: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {}, OBSERVE: {} } }
				}
			},
			succeeded: { type: 'final', entry: clear },
			denied: blocked('denied'),
			unavailable: blocked('unavailable'),
			failed: { type: 'final', entry: clear },
			cancelled: interrupted('cancelled'),
			scopeChanged: interrupted('scopeChanged'),
			closed: interrupted('closed')
		}
	})
}
