import {
	assign,
	fromPromise,
	raise,
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
	FormCapabilityReportEvent,
	FormMode,
	FormChildEvent,
	FormObservation,
	FormOperationInput,
	FormOperationResult,
	FormRequest,
	FormResult,
	ScopedFormView,
	FormSubmissionProgressEvent
} from '#lib/form-contract.js'
import { createScopedFormSubmissionMachine } from './scoped-form-submission.js'
import { createScopedFormReadinessMachine } from './scoped-form-readiness.js'

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
	/** Post-persistence I/O owned by the workflow. */
	complete?: (scope: Scope, signal: AbortSignal) => Promise<void>
	/** Release file drafts and rebuild controls after successful inline saves. */
	resetOnSuccess?: boolean
} & FormMode<Values, Observation>

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
	type Context = {
		observation: FormObservation<Observation> | undefined
		scope: { value: Scope } | undefined
		scopeRevision: number
		watchGeneration: number
		capability: FormCapability<Scope, Reason> | undefined
		request: FormRequest<Scope> | undefined
		sequence: number
		result: FormResult<Result, Reason> | undefined
		draftRevision: number
		draft: unknown
	}
	type Event =
		| FormSubmissionProgressEvent
		| { type: 'OBSERVE'; observation: Observation }
		| { type: 'SUBMIT'; values: unknown }
		| { type: 'CHANGE'; values: unknown }
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
		| FormCapabilityReportEvent<Scope, Reason>
	const availability = createScopedFormReadinessMachine<
		Scope,
		Reason,
		Observation,
		AvailabilitySnapshot
	>(options)
	const completion = fromPromise<void, { scope: Scope }>(async ({ input, signal }) => {
		if (!options.complete) throw new Error('Missing form completion effect')
		await options.complete(input.scope, signal)
	})
	const actors = { availability, submission, completion }
	const ready = (context: Context) =>
		context.capability?.revision === context.observation?.revision &&
		context.capability?.readiness.kind === 'ready' &&
		context.scope !== undefined &&
		options.sameScope(context.capability.scope, context.scope.value)
	const editable = (context: Context) =>
		ready(context) &&
		(options.successContent === 'retain' || context.result?.outcome !== 'succeeded')
	const hasChanges = (context: Context, values: unknown) =>
		options.mode !== 'edit' ||
		(values !== undefined &&
			context.observation !== undefined &&
			!options.valuesEqual(values, options.initialValues(context.observation.facts)))
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{ availability: 'availability'; submission: 'submission'; completion: 'completion' },
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
		draft: undefined,
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
			watchGeneration: 0,
			capability: undefined,
			request: undefined,
			sequence: 0,
			result: undefined,
			draftRevision: 0,
			draft: undefined
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
									capability: undefined,
									observation: ({ context, event }) => ({
										revision: requireObservation(context).revision + 1,
										facts: event.observation
									}),
									scope: ({ event }) => ({ value: options.scopeOf(event.observation) }),
									scopeRevision: ({ context }) => context.scopeRevision + 1,
									draftRevision: ({ context }) => context.draftRevision + 1,
									draft: undefined,
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
									capability: undefined,
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
					FORM_CAPABILITY_REPORTED: [
						{ guard: 'closing' },
						{
							guard: and([
								'availabilityWatching',
								({ context, event }) =>
									event.generation === context.watchGeneration &&
									event.capability.revision === context.observation?.revision &&
									context.scope !== undefined &&
									options.sameScope(event.capability.scope, context.scope.value)
							]),
							actions: [
								assign({ capability: ({ event }) => event.capability }),
								raise({ type: 'CAPABILITY_ACCEPTED' }),
								workflow.enqueueActions(({ event, enqueue }) => {
									if (
										event.type === 'FORM_CAPABILITY_REPORTED' &&
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
								entry: assign({
									watchGeneration: ({ context }) => context.watchGeneration + 1,
									capability: undefined
								}),
								initial: 'awaiting',
								states: { awaiting: {}, current: {} },
								invoke: {
									id: 'availability',
									src: 'availability',
									input: ({ context, self }) => ({
										observation: requireObservation(context),
										delivery: {
											kind: 'watch',
											generation: context.watchGeneration,
											recipient: self
										}
									}),
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
										guard: and([
											'availabilityWatching',
											({ context, event }) => editable(context) && hasChanges(context, event.values)
										]),
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
											draft: ({ event }) => (options.mode === 'edit' ? event.values : undefined),
											result: undefined
										})
									},
									CHANGE: {
										guard: and(['availabilityWatching', ({ context }) => editable(context)]),
										actions: assign({
											draft: ({ event }) => (options.mode === 'edit' ? event.values : undefined),
											result: ({ context }) =>
												context.result?.outcome === 'succeeded' ? undefined : context.result
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
									input: ({ context, self }) => {
										if (!context.request) throw new Error('Missing form request')
										return {
											request: context.request,
											observation: requireObservation(context),
											recipient: self
										}
									},
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
												request: undefined
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
												request: undefined
											})
										},
										{
											guard: ({ context, event }) =>
												options.complete !== undefined &&
												event.output.outcome === 'succeeded' &&
												context.request?.scopeRevision === context.scopeRevision,
											target: 'completion',
											actions: assign({
												result: ({ event }) => event.output,
												request: undefined
											})
										},
										{
											target: 'idle',
											actions: assign({
												result: ({ context, event }) =>
													context.request?.scopeRevision === context.scopeRevision
														? event.output
														: undefined,
												draft: ({ context, event }) =>
													options.resetOnSuccess && event.output.outcome === 'succeeded'
														? undefined
														: context.draft,
												draftRevision: ({ context, event }) =>
													options.resetOnSuccess && event.output.outcome === 'succeeded'
														? context.draftRevision + 1
														: context.draftRevision,
												request: undefined
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
												request: undefined
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
												request: undefined
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
												request: undefined
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
									pending: {
										tags: 'can-open',
										initial: 'awaitingProgress',
										states: {
											awaitingProgress: {},
											validating: { tags: 'validating' },
											operating: {}
										},
										on: {
											FORM_SUBMISSION_PROGRESS: [
												{
													guard: ({ context, event }) =>
														context.request?.id === event.requestId &&
														context.request.scopeRevision === event.scopeRevision &&
														context.scopeRevision === event.scopeRevision &&
														event.progress === 'validating',
													target: '.validating'
												},
												{
													guard: ({ context, event }) =>
														context.request?.id === event.requestId &&
														context.request.scopeRevision === event.scopeRevision &&
														context.scopeRevision === event.scopeRevision &&
														event.progress === 'operating',
													target: '.operating'
												}
											]
										}
									},
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
											FORM_CAPABILITY_REPORTED: {}
										}
									}
								}
							},
							completion: {
								initial: 'navigating',
								on: {
									SHUTDOWN: 'closed',
									INVALIDATE: {
										// Scope changes clear the result before raising INVALIDATE.
										// Capability refreshes cannot undo an already persisted success.
										guard: ({ context }) => context.result === undefined,
										target: 'idle',
										actions: clearDraft
									},
									CANCEL: { target: 'idle', actions: clearDraft }
								},
								states: {
									navigating: {
										invoke: {
											id: 'completion',
											src: 'completion',
											input: ({ context }) => {
												if (!context.scope) throw new Error('Missing saved form scope')
												return { scope: context.scope.value }
											},
											onDone: 'completed',
											onError: 'failed'
										}
									},
									failed: { on: { SUBMIT: 'navigating' } },
									completed: {}
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
					draft: undefined
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
	const { capability, result } = snapshot.context
	const closing = snapshot.matches({ open: { workflow: { active: 'closing' } } })
	const invalidated = snapshot.matches({ open: { workflow: { active: 'invalidated' } } })
	const cancelling = snapshot.matches({ open: { workflow: { active: 'cancelling' } } })
	const closed =
		snapshot.status === 'done' || snapshot.matches({ open: { availability: 'closed' } })
	const failed = snapshot.status === 'error' || snapshot.status === 'stopped'
	const completing = snapshot.matches({ open: { workflow: 'completion' } })
	const navigationPending = snapshot.matches({ open: { workflow: { completion: 'navigating' } } })
	const completionFailed = snapshot.matches({ open: { workflow: { completion: 'failed' } } })
	const readiness: ScopedFormView<Result, Reason>['readiness'] = closed
		? { kind: 'closed' }
		: completing
			? { kind: 'ready' }
			: failed || snapshot.matches({ open: { availability: 'failed' } })
				? { kind: 'failed' }
				: snapshot.matches({ open: { availability: { watching: 'current' } } }) && capability
					? capability.readiness
					: { kind: 'observing' }
	const canSubmit = !failed && snapshot.can({ type: 'SUBMIT', values: snapshot.context.draft })
	return {
		readiness,
		content:
			!completing && result?.outcome === 'succeeded' && options.successContent !== 'retain'
				? { kind: 'success', value: result.value }
				: { kind: 'fields' },
		activity: failed
			? { kind: 'idle' }
			: closing || invalidated || cancelling
				? {
						kind: 'settling',
						reason: closing ? 'closed' : invalidated ? 'scopeChanged' : 'cancelled'
					}
				: snapshot.hasTag('validating')
					? { kind: 'validating' }
					: snapshot.matches({ open: { workflow: 'active' } }) || navigationPending
						? { kind: 'operating' }
						: { kind: 'idle' },
		feedback: completionFailed
			? {
					kind: 'result',
					result: {
						outcome: 'failed',
						code: 'completionFailed',
						settlement: result?.settlement ?? 'locallyPersisted'
					}
				}
			: !completing && result
				? { kind: 'result', result }
				: { kind: 'none' },
		canSubmit,
		fieldsEditable: !failed && snapshot.can({ type: 'CHANGE', values: undefined }),
		canReset: !failed && snapshot.can({ type: 'RESET' }),
		canOpen: !failed && snapshot.hasTag('can-open'),
		canCancel: !failed && snapshot.matches({ open: { workflow: { active: 'pending' } } }),
		canRetryReadiness: !failed && snapshot.can({ type: 'RETRY_READINESS' }),
		draftRevision: snapshot.context.draftRevision
	}
}
