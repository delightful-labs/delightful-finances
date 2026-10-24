import {
	assign,
	enqueueActions,
	fromPromise,
	setup,
	stateIn,
	type ActorLogic,
	type Snapshot
} from 'xstate'
import type { z } from 'zod'
import type { PicaCanvas } from 'pica'
import * as image from '#lib/domain/avatar.js'
import { profileAvatarFormSchema, profileAvatarValuesSchema } from '#lib/validation/identity.js'
import type {
	FormChildEvent,
	FormInterruption,
	FormObservation,
	FormOperationInput,
	FormOperationResult
} from '#lib/form-contract.js'
import type { ProfileObservation, ProfileReason, ProfileScope } from '#lib/profile-contract.js'

type Draft = z.output<typeof profileAvatarFormSchema>
type Values = z.output<typeof profileAvatarValuesSchema>
type Input = FormOperationInput<Draft, ProfileScope, ProfileObservation>
type Result = FormOperationResult<void, ProfileReason>
type Event = FormChildEvent<ProfileObservation>
type Context = {
	request: Omit<Input['request'], 'values'> | undefined
	draft: Draft | undefined
	observation: FormObservation<ProfileObservation> | undefined
	bitmap: ImageBitmap | undefined
	canvas: PicaCanvas | undefined
	blob: Blob | undefined
	bytes: Uint8Array | undefined
	prepared: Values | undefined
	result: Result | undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing avatar resource')
	return value
}
const failed: Result = { outcome: 'failed', code: 'operationFailed', settlement: 'notStarted' }

/** Owns image resources through cleanup, then delegates readiness and settlement to the write child. */
export function createProfileAvatarMachine<WriteSnapshot extends Snapshot<Result>>(options: {
	write: ActorLogic<
		WriteSnapshot,
		Event,
		FormOperationInput<Values, ProfileScope, ProfileObservation>
	>
	scopeOf: (facts: ProfileObservation) => ProfileScope
	sameScope: (left: ProfileScope, right: ProfileScope) => boolean
}) {
	const actors = {
		decode: fromPromise(({ input }: { input: File }) => image.decodeAvatar(input)),
		initialize: fromPromise(() => image.initializeAvatarResizer()),
		canvas: fromPromise(async ({ input }: { input: ImageBitmap }) =>
			image.createAvatarCanvas(input)
		),
		resize: fromPromise(({ input }: { input: { bitmap: ImageBitmap; canvas: PicaCanvas } }) =>
			image.resizeAvatarImage(input.bitmap, input.canvas)
		),
		encode: fromPromise(({ input }: { input: PicaCanvas }) => image.encodeAvatar(input)),
		read: fromPromise(({ input }: { input: Blob }) => image.readAvatarBytes(input)),
		validate: fromPromise(async ({ input }: { input: { bytes: Uint8Array; mimeType: string } }) =>
			profileAvatarValuesSchema.safeParse({
				avatarData: input.bytes,
				avatarMimeType: input.mimeType
			})
		),
		closeBitmap: fromPromise(async ({ input }: { input: ImageBitmap }) =>
			image.releaseAvatarBitmap(input)
		),
		closeCanvas: fromPromise(async ({ input }: { input: PicaCanvas }) =>
			image.releaseAvatarCanvas(input)
		),
		write: options.write
	}
	const model = setup<
		Context,
		Event,
		typeof actors,
		{},
		{ forward: undefined; fail: undefined },
		{
			interrupted: undefined
			closing: undefined
			invalidated: undefined
			cancelling: undefined
		},
		never,
		string,
		Input,
		Result
	>({
		actors,
		actions: {
			fail: assign({ result: (): Result => failed }),
			forward: enqueueActions(({ context, self, event, enqueue }) => {
				const child = self.getSnapshot().children.write
				if (child?.getSnapshot().status !== 'active') return
				const changed =
					event.type === 'OBSERVE' &&
					!options.sameScope(
						required(context.request).scope,
						options.scopeOf(event.observation.facts)
					)
				enqueue.sendTo(child, changed ? { type: 'INVALIDATE' } : event)
			})
		},
		guards: {
			interrupted: stateIn({ running: { control: 'interrupted' } }),
			closing: stateIn({ running: { control: { interrupted: 'closed' } } }),
			invalidated: stateIn({ running: { control: { interrupted: 'scopeChanged' } } }),
			cancelling: stateIn({ running: { control: { interrupted: 'cancelled' } } })
		}
	})
	const observe = model.assign({
		observation: ({ context, event }) =>
			event.type === 'OBSERVE' ? event.observation : context.observation
	})
	const clear = model.assign({
		request: undefined,
		draft: undefined,
		observation: undefined,
		bitmap: undefined,
		canvas: undefined,
		blob: undefined,
		bytes: undefined,
		prepared: undefined
	})
	const terminal = (outcome?: FormInterruption) =>
		model.createStateConfig({
			type: 'final',
			entry: [
				model.assign({
					result: ({ context }): Result =>
						outcome
							? { outcome, settlement: context.result?.settlement ?? 'notStarted' }
							: (context.result ?? failed)
				}),
				clear
			]
		})
	return model.createMachine({
		id: 'profile-avatar',
		initial: 'running',
		context: ({ input }) => ({
			request: {
				id: input.request.id,
				scope: input.request.scope,
				scopeRevision: input.request.scopeRevision
			},
			draft: input.request.values,
			observation: input.observation,
			bitmap: undefined,
			canvas: undefined,
			blob: undefined,
			bytes: undefined,
			prepared: undefined,
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		states: {
			running: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						on: {
							CANCEL: { target: '.interrupted.cancelled', actions: 'forward' },
							INVALIDATE: { target: '.interrupted.scopeChanged', actions: 'forward' },
							SHUTDOWN: { target: '.interrupted.closed', actions: 'forward' },
							OBSERVE: [
								{
									guard: ({ context, event }) =>
										!options.sameScope(
											required(context.request).scope,
											options.scopeOf(event.observation.facts)
										),
									target: '.interrupted.scopeChanged',
									actions: ['forward', observe]
								},
								{ actions: ['forward', observe] }
							]
						},
						states: {
							active: {},
							interrupted: {
								initial: 'cancelled',
								states: {
									cancelled: { on: { CANCEL: {} } },
									scopeChanged: { on: { CANCEL: {}, INVALIDATE: {}, OBSERVE: {} } },
									closed: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {}, OBSERVE: {} } }
								}
							}
						}
					},
					flow: {
						initial: 'choosing',
						states: {
							choosing: {
								always: [
									{ guard: 'interrupted', target: 'cleanup' },
									{
										guard: ({ context }) => context.draft?.action === 'remove',
										target: 'ready',
										actions: assign({
											prepared: () => ({ avatarData: null, avatarMimeType: null })
										})
									},
									{ target: 'decoding' }
								]
							},
							decoding: {
								invoke: {
									src: 'decode',
									input: ({ context }) => {
										const draft = required(context.draft)
										if (draft.action !== 'upload') throw new Error('Missing avatar upload')
										return draft.file
									},
									onDone: [
										{
											guard: 'interrupted',
											target: 'cleanup',
											actions: assign({ bitmap: ({ event }) => event.output })
										},
										{
											target: 'initializing',
											actions: assign({ bitmap: ({ event }) => event.output })
										}
									],
									onError: { target: 'cleanup', actions: 'fail' }
								}
							},
							initializing: {
								invoke: {
									src: 'initialize',
									onDone: [
										{ guard: 'interrupted', target: 'cleanup' },
										{ target: 'creatingCanvas' }
									],
									onError: { target: 'cleanup', actions: 'fail' }
								}
							},
							creatingCanvas: {
								invoke: {
									src: 'canvas',
									input: ({ context }) => required(context.bitmap),
									onDone: [
										{
											guard: 'interrupted',
											target: 'cleanup',
											actions: assign({ canvas: ({ event }) => event.output })
										},
										{ target: 'resizing', actions: assign({ canvas: ({ event }) => event.output }) }
									],
									onError: { target: 'cleanup', actions: 'fail' }
								}
							},
							resizing: {
								invoke: {
									src: 'resize',
									input: ({ context }) => ({
										bitmap: required(context.bitmap),
										canvas: required(context.canvas)
									}),
									onDone: [{ guard: 'interrupted', target: 'cleanup' }, { target: 'encoding' }],
									onError: { target: 'cleanup', actions: 'fail' }
								}
							},
							encoding: {
								invoke: {
									src: 'encode',
									input: ({ context }) => required(context.canvas),
									onDone: [
										{ guard: 'interrupted', target: 'cleanup' },
										{
											guard: ({ event }) => event.output instanceof Blob,
											target: 'readingBytes',
											actions: assign({ blob: ({ event }) => event.output ?? undefined })
										},
										{ target: 'cleanup', actions: 'fail' }
									],
									onError: { target: 'cleanup', actions: 'fail' }
								}
							},
							readingBytes: {
								invoke: {
									src: 'read',
									input: ({ context }) => required(context.blob),
									onDone: [
										{
											guard: 'interrupted',
											target: 'cleanup',
											actions: assign({ bytes: ({ event }) => event.output })
										},
										{
											target: 'validatingBytes',
											actions: assign({ bytes: ({ event }) => event.output })
										}
									],
									onError: { target: 'cleanup', actions: 'fail' }
								}
							},
							validatingBytes: {
								invoke: {
									src: 'validate',
									input: ({ context }) => ({
										bytes: required(context.bytes),
										mimeType: required(context.blob).type
									}),
									onDone: [
										{
											guard: ({ event }) => event.output.success,
											target: 'cleanup',
											actions: assign({ prepared: ({ event }) => event.output.data })
										},
										{ target: 'cleanup', actions: 'fail' }
									],
									onError: { target: 'cleanup', actions: 'fail' }
								}
							},
							cleanup: {
								initial: 'bitmap',
								onDone: 'ready',
								states: {
									bitmap: {
										always: [
											{
												guard: ({ context }) => context.bitmap !== undefined,
												target: 'closingBitmap'
											},
											{ target: 'canvas' }
										]
									},
									closingBitmap: {
										invoke: {
											src: 'closeBitmap',
											input: ({ context }) => required(context.bitmap),
											onDone: { target: 'canvas', actions: assign({ bitmap: undefined }) },
											onError: {
												target: 'canvas',
												actions: ['fail', assign({ bitmap: undefined })]
											}
										}
									},
									canvas: {
										always: [
											{
												guard: ({ context }) => context.canvas !== undefined,
												target: 'closingCanvas'
											},
											{ target: 'done' }
										]
									},
									closingCanvas: {
										invoke: {
											src: 'closeCanvas',
											input: ({ context }) => required(context.canvas),
											onDone: { target: 'done', actions: assign({ canvas: undefined }) },
											onError: { target: 'done', actions: ['fail', assign({ canvas: undefined })] }
										}
									},
									done: {
										type: 'final',
										entry: assign({ blob: undefined, bytes: undefined, draft: undefined })
									}
								}
							},
							ready: {
								always: [
									{ guard: 'interrupted', target: 'finishing' },
									{ guard: ({ context }) => context.result !== undefined, target: 'finishing' },
									{ target: 'saving' }
								]
							},
							saving: {
								invoke: {
									id: 'write',
									src: 'write',
									input: ({ context }) => ({
										request: { ...required(context.request), values: required(context.prepared) },
										observation: required(context.observation)
									}),
									onDone: {
										target: 'finishing',
										actions: assign({
											result: ({ event }) =>
												event.output ?? {
													outcome: 'failed',
													code: 'unexpected',
													settlement: 'unknown'
												}
										})
									},
									onError: {
										target: 'finishing',
										actions: assign({
											result: () => ({
												outcome: 'failed',
												code: 'operationFailed',
												settlement: 'unknown'
											})
										})
									}
								}
							},
							finishing: {
								always: [
									{ guard: 'closing', target: '#profile-avatar.closed' },
									{ guard: 'invalidated', target: '#profile-avatar.scopeChanged' },
									{ guard: 'cancelling', target: '#profile-avatar.cancelled' },
									{
										guard: ({ context }) => context.result?.outcome === 'succeeded',
										target: '#profile-avatar.succeeded'
									},
									{
										guard: ({ context }) => context.result?.outcome === 'partial',
										target: '#profile-avatar.partial'
									},
									{
										guard: ({ context }) => context.result?.outcome === 'denied',
										target: '#profile-avatar.denied'
									},
									{
										guard: ({ context }) => context.result?.outcome === 'unavailable',
										target: '#profile-avatar.unavailable'
									},
									{
										guard: ({ context }) => context.result?.outcome === 'closed',
										target: '#profile-avatar.closed'
									},
									{
										guard: ({ context }) => context.result?.outcome === 'scopeChanged',
										target: '#profile-avatar.scopeChanged'
									},
									{
										guard: ({ context }) => context.result?.outcome === 'cancelled',
										target: '#profile-avatar.cancelled'
									},
									{ target: '#profile-avatar.failed' }
								]
							}
						}
					}
				}
			},
			succeeded: terminal(),
			partial: terminal(),
			denied: terminal(),
			unavailable: terminal(),
			failed: terminal(),
			closed: terminal('closed'),
			scopeChanged: terminal('scopeChanged'),
			cancelled: terminal('cancelled')
		}
	})
}
