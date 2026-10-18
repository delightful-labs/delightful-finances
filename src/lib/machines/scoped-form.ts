import {
	assign,
	raise,
	sendParent,
	and,
	setup,
	stateIn,
	type ActorLogic,
	type Snapshot,
	type SnapshotFrom
} from 'xstate'
import type { z } from 'zod'
import type {
	FormCapability,
	FormChildEvent,
	FormObservation,
	FormOperationInput,
	FormOperationResult,
	FormRequest,
	FormResult,
	ScopedFormView
} from '#lib/form-contract.js'
import { createScopedFormSubmissionMachine } from './scoped-form-submission.js'

export type ScopedFormOptions<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	AvailabilitySnapshot extends Snapshot<unknown>,
	OperationSnapshot extends Snapshot<FormOperationResult<Result, Reason>>
> = {
	schema: z.ZodType<Values>
	availability: ActorLogic<
		AvailabilitySnapshot,
		FormChildEvent<Observation>,
		FormObservation<Observation>
	>
	selectAvailability: (snapshot: AvailabilitySnapshot) => FormCapability<Scope, Reason>
	operation: ActorLogic<
		OperationSnapshot,
		FormChildEvent<Observation>,
		FormOperationInput<Values, Scope, Observation>
	>
	scopeOf: (observation: Observation) => Scope
	sameScope: (left: Scope, right: Scope) => boolean
	successContent?: 'replace' | 'retain'
}

export function createScopedFormMachine<
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
	>
) {
	const submission = createScopedFormSubmissionMachine<
		Values,
		Result,
		Reason,
		Scope,
		Observation,
		OperationSnapshot
	>(options)
	type SubmissionSnapshot = SnapshotFrom<typeof submission>
	type Context = {
		observation: FormObservation<Observation> | undefined
		scope: { value: Scope } | undefined
		scopeRevision: number
		capability: FormCapability<Scope, Reason> | undefined
		request: FormRequest<Scope> | undefined
		sequence: number
		result: FormResult<Result, Reason> | undefined
		submission: SubmissionSnapshot | undefined
		draftRevision: number
	}
	type Event =
		| { type: 'OBSERVE'; observation: Observation }
		| { type: 'SUBMIT'; values: unknown }
		| {
				type:
					| 'RESET'
					| 'OPEN'
					| 'CANCEL'
					| 'SHUTDOWN'
					| 'RETRY_READINESS'
					| 'INVALIDATE'
					| 'AVAILABILITY_FAILED'
					| 'OBSERVATION_CHANGED'
					| 'CAPABILITY_ACCEPTED'
		  }
		| { type: 'CAPABILITY_UPDATED'; capability: FormCapability<Scope, Reason> }
	const availability = setup<
		{ observation: FormObservation<Observation> },
		FormChildEvent<Observation>,
		{ source: typeof options.availability },
		{},
		{},
		{},
		never,
		string,
		FormObservation<Observation>
	>({ actors: { source: options.availability } }).createMachine({
		id: 'scoped-form-availability',
		initial: 'watching',
		context: ({ input }) => ({ observation: input }),
		states: {
			watching: {
				invoke: {
					id: 'source',
					src: 'source',
					input: ({ context }) => context.observation,
					onSnapshot: {
						guard: ({ event }) => event.snapshot.status === 'active',
						actions: sendParent(({ event }) => ({
							type: 'CAPABILITY_UPDATED',
							capability: options.selectAvailability(event.snapshot)
						}))
					},
					onError: 'failed',
					onDone: 'failed'
				},
				on: {
					OBSERVE: {
						actions: [
							assign({ observation: ({ event }) => event.observation }),
							({ self, event }) => {
								const child = self.getSnapshot().children.source
								if (child?.getSnapshot().status === 'active') child.send(event)
							}
						]
					}
				}
			},
			failed: { type: 'final' }
		}
	})
	const actors = { availability, submission }
	const ready = (context: Context) =>
		context.capability?.revision === context.observation?.revision &&
		context.capability?.readiness.kind === 'ready' &&
		context.scope !== undefined &&
		options.sameScope(context.capability.scope, context.scope.value)
	const editable = (context: Context) =>
		ready(context) &&
		(options.successContent === 'retain' || context.result?.outcome !== 'succeeded')
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{
			closing: undefined
			invalidated: undefined
			cancelling: undefined
			availabilityWatching: undefined
			idle: undefined
		},
		never,
		string,
		Observation
	>({
		actors,
		guards: {
			closing: stateIn({ open: { workflow: { active: 'closing' } } }),
			invalidated: stateIn({ open: { workflow: { active: 'invalidated' } } }),
			cancelling: stateIn({ open: { workflow: { active: 'cancelling' } } }),
			availabilityWatching: stateIn({ open: { availability: 'watching' } }),
			idle: stateIn({ open: { workflow: 'idle' } })
		}
	})
	const forwardObservation = workflow.enqueueActions(({ self, context, enqueue }) => {
		const children = self.getSnapshot().children
		const observation = context.observation
		if (!observation) return
		if (children.availability?.getSnapshot().status === 'active')
			enqueue.sendTo(children.availability, { type: 'OBSERVE', observation })
		if (children.submission?.getSnapshot().status === 'active')
			enqueue.sendTo(children.submission, { type: 'OBSERVE', observation })
	})
	const command = (type: 'INVALIDATE' | 'CANCEL' | 'SHUTDOWN') =>
		workflow.enqueueActions(({ self, enqueue }) => {
			const child = self.getSnapshot().children.submission
			if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type })
		})
	const clearDraft = workflow.assign({
		result: undefined,
		draftRevision: ({ context }) => context.draftRevision + 1
	})
	const requireObservation = (context: Context) => {
		if (!context.observation) throw new Error('Missing form observation')
		return context.observation
	}
	return workflow.createMachine({
		id: 'scoped-form',
		initial: 'open',
		context: ({ input }) => ({
			observation: { revision: 0, facts: input },
			scope: { value: options.scopeOf(input) },
			scopeRevision: 0,
			capability: undefined,
			request: undefined,
			sequence: 0,
			result: undefined,
			submission: undefined,
			draftRevision: 0
		}),
		states: {
			open: {
				type: 'parallel',
				onDone: 'closed',
				on: {
					OBSERVE: [
						{ guard: 'closing' },
						{
							guard: ({ context, event }) =>
								context.scope !== undefined &&
								!options.sameScope(context.scope.value, options.scopeOf(event.observation)),
							actions: [
								assign({
									observation: ({ context, event }) => ({
										revision: requireObservation(context).revision + 1,
										facts: event.observation
									}),
									scope: ({ event }) => ({ value: options.scopeOf(event.observation) }),
									scopeRevision: ({ context }) => context.scopeRevision + 1,
									draftRevision: ({ context }) => context.draftRevision + 1,
									result: undefined
								}),
								raise({ type: 'INVALIDATE' }),
								raise({ type: 'OBSERVATION_CHANGED' }),
								forwardObservation
							]
						},
						{
							actions: [
								assign({
									observation: ({ context, event }) => ({
										revision: requireObservation(context).revision + 1,
										facts: event.observation
									})
								}),
								raise({ type: 'OBSERVATION_CHANGED' }),
								forwardObservation
							]
						}
					],
					CAPABILITY_UPDATED: [
						{ guard: 'closing' },
						{
							guard: and([
								'availabilityWatching',
								({ context, event }) =>
									event.capability.revision === context.observation?.revision &&
									context.scope !== undefined &&
									options.sameScope(event.capability.scope, context.scope.value)
							]),
							actions: [
								assign({ capability: ({ event }) => event.capability }),
								raise({ type: 'CAPABILITY_ACCEPTED' }),
								workflow.enqueueActions(({ event, enqueue }) => {
									if (
										event.type === 'CAPABILITY_UPDATED' &&
										event.capability.readiness.kind === 'blocked'
									)
										enqueue.raise({ type: 'INVALIDATE' })
								})
							]
						}
					]
				},
				states: {
					availability: {
						initial: 'watching',
						states: {
							watching: {
								initial: 'awaiting',
								states: { awaiting: {}, current: {} },
								invoke: {
									id: 'availability',
									src: 'availability',
									input: ({ context }) => requireObservation(context),
									onError: 'failed',
									onDone: 'failed'
								},
								on: {
									SHUTDOWN: 'closed',
									OBSERVATION_CHANGED: '.awaiting',
									CAPABILITY_ACCEPTED: '.current'
								}
							},
							failed: {
								entry: [assign({ capability: undefined }), raise({ type: 'AVAILABILITY_FAILED' })],
								on: {
									RETRY_READINESS: {
										guard: 'idle',
										target: 'watching'
									},
									SHUTDOWN: 'closed'
								}
							},
							closed: { type: 'final' }
						}
					},
					workflow: {
						initial: 'idle',
						states: {
							idle: {
								tags: 'can-open',
								on: {
									SUBMIT: {
										guard: and(['availabilityWatching', ({ context }) => editable(context)]),
										target: 'active',
										actions: assign({
											request: ({ context, event }) => {
												if (!context.scope) throw new Error('Missing form scope')
												return {
													id: context.sequence + 1,
													scope: context.scope.value,
													scopeRevision: context.scopeRevision,
													values: event.values
												}
											},
											sequence: ({ context }) => context.sequence + 1,
											result: undefined
										})
									},
									RESET: { actions: clearDraft },
									OPEN: {
										guard: ({ context }) => context.result?.outcome === 'succeeded',
										actions: clearDraft
									},
									SHUTDOWN: 'closed'
								}
							},
							active: {
								initial: 'pending',
								invoke: {
									id: 'submission',
									src: 'submission',
									input: ({ context }) => {
										if (!context.request) throw new Error('Missing form request')
										return { request: context.request, observation: requireObservation(context) }
									},
									onSnapshot: { actions: assign({ submission: ({ event }) => event.snapshot }) },
									onDone: [
										{ guard: 'closing', target: 'closed' },
										{
											guard: 'invalidated',
											target: 'idle',
											actions: assign({
												result: ({ context, event }) =>
													context.request?.scopeRevision === context.scopeRevision
														? { outcome: 'scopeChanged', settlement: event.output.settlement }
														: undefined,
												request: undefined,
												submission: undefined
											})
										},
										{
											guard: 'cancelling',
											target: 'idle',
											actions: assign({
												result: ({ context, event }) =>
													context.request?.scopeRevision === context.scopeRevision
														? { outcome: 'cancelled', settlement: event.output.settlement }
														: undefined,
												request: undefined,
												submission: undefined
											})
										},
										{
											target: 'idle',
											actions: assign({
												result: ({ context, event }) =>
													context.request?.scopeRevision === context.scopeRevision
														? event.output
														: undefined,
												request: undefined,
												submission: undefined
											})
										}
									],
									onError: [
										{ guard: 'closing', target: 'closed' },
										{
											guard: 'invalidated',
											target: 'idle',
											actions: assign({
												result: ({ context }) =>
													context.request?.scopeRevision === context.scopeRevision
														? { outcome: 'scopeChanged', settlement: 'unknown' }
														: undefined,
												request: undefined,
												submission: undefined
											})
										},
										{
											guard: 'cancelling',
											target: 'idle',
											actions: assign({
												result: ({ context }) =>
													context.request?.scopeRevision === context.scopeRevision
														? { outcome: 'cancelled', settlement: 'unknown' }
														: undefined,
												request: undefined,
												submission: undefined
											})
										},
										{
											target: 'idle',
											actions: assign({
												result: ({ context }) =>
													context.request?.scopeRevision === context.scopeRevision
														? {
																outcome: 'failed',
																code: 'unexpected',
																settlement: 'unknown'
															}
														: undefined,
												request: undefined,
												submission: undefined
											})
										}
									]
								},
								on: {
									INVALIDATE: { target: '.invalidated', actions: command('INVALIDATE') },
									AVAILABILITY_FAILED: { target: '.invalidated', actions: command('INVALIDATE') },
									CANCEL: { target: '.cancelling', actions: command('CANCEL') },
									SHUTDOWN: { target: '.closing', actions: command('SHUTDOWN') }
								},
								states: {
									pending: { tags: 'can-open' },
									cancelling: { tags: 'can-open', on: { CANCEL: {} } },
									invalidated: {
										tags: 'can-open',
										on: { CANCEL: {}, INVALIDATE: {}, AVAILABILITY_FAILED: {} }
									},
									closing: {
										on: {
											SHUTDOWN: {},
											CANCEL: {},
											INVALIDATE: {},
											AVAILABILITY_FAILED: {},
											OBSERVE: {},
											CAPABILITY_UPDATED: {}
										}
									}
								}
							},
							closed: { type: 'final' }
						}
					}
				}
			},
			closed: {
				type: 'final',
				entry: workflow.assign({
					observation: undefined,
					scope: undefined,
					capability: undefined,
					request: undefined,
					result: undefined,
					submission: undefined
				})
			}
		}
	})
}

export function selectScopedFormView<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	AvailabilitySnapshot extends Snapshot<unknown>,
	OperationSnapshot extends Snapshot<FormOperationResult<Result, Reason>>
>(
	snapshot: SnapshotFrom<
		ReturnType<
			typeof createScopedFormMachine<
				Values,
				Result,
				Reason,
				Scope,
				Observation,
				AvailabilitySnapshot,
				OperationSnapshot
			>
		>
	>,
	options: Pick<
		ScopedFormOptions<
			Values,
			Result,
			Reason,
			Scope,
			Observation,
			AvailabilitySnapshot,
			OperationSnapshot
		>,
		'successContent'
	>
): ScopedFormView<Result, Reason> {
	const { capability, result, submission } = snapshot.context
	const closing = snapshot.matches({ open: { workflow: { active: 'closing' } } })
	const invalidated = snapshot.matches({ open: { workflow: { active: 'invalidated' } } })
	const cancelling = snapshot.matches({ open: { workflow: { active: 'cancelling' } } })
	const closed =
		snapshot.status === 'done' || snapshot.matches({ open: { availability: 'closed' } })
	const failed = snapshot.status === 'error' || snapshot.status === 'stopped'
	const readiness: ScopedFormView<Result, Reason>['readiness'] = closed
		? { kind: 'closed' }
		: failed || snapshot.matches({ open: { availability: 'failed' } })
			? { kind: 'failed' }
			: snapshot.matches({ open: { availability: { watching: 'current' } } }) && capability
				? capability.readiness
				: { kind: 'observing' }
	const canSubmit = !failed && snapshot.can({ type: 'SUBMIT', values: undefined })
	return {
		readiness,
		content:
			result?.outcome === 'succeeded' && options.successContent !== 'retain'
				? { kind: 'success', value: result.value }
				: { kind: 'fields' },
		activity: failed
			? { kind: 'idle' }
			: closing || invalidated || cancelling
				? {
						kind: 'settling',
						reason: closing ? 'closed' : invalidated ? 'scopeChanged' : 'cancelled'
					}
				: submission?.hasTag('validating')
					? { kind: 'validating' }
					: snapshot.matches({ open: { workflow: 'active' } })
						? { kind: 'operating' }
						: { kind: 'idle' },
		feedback: result ? { kind: 'result', result } : { kind: 'none' },
		canSubmit,
		fieldsEditable: canSubmit,
		canReset: !failed && snapshot.can({ type: 'RESET' }),
		canOpen: !failed && snapshot.hasTag('can-open'),
		canCancel: !failed && snapshot.matches({ open: { workflow: { active: 'pending' } } }),
		canRetryReadiness: !failed && snapshot.can({ type: 'RETRY_READINESS' }),
		draftRevision: snapshot.context.draftRevision
	}
}
