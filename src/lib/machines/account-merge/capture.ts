import { assign, fromCallback, fromPromise, setup } from 'xstate'
import type { AccountMergeSnapshot } from '#lib/schema/account-merge.js'
import {
	mergeCaptureScopes,
	type MergeCaptureDependencies,
	type MergeCaptureResult,
	type MergeCaptureRows,
	type MergeCaptureScope
} from '#lib/schema/account-merge-capture.js'
import type {
	MergeDestination,
	MergeDestinationSession
} from '#lib/schema/account-merge-destination.js'
import { mergeDestinationSchema } from '#lib/validation/account-merge-journal.js'
import { accountMergeSnapshotSchema } from '#lib/validation/account-merge.js'
import { required } from '../bank-sync/identity.js'

type Context = {
	source: MergeDestination | undefined
	rows: MergeCaptureRows
	attachments: readonly unknown[] | undefined
	validation: ReturnType<typeof accountMergeSnapshotSchema.safeParse> | undefined
	result: MergeCaptureResult | undefined
}
type Event =
	| { type: 'SESSION'; session: MergeDestinationSession }
	| { type: 'ROWS'; scope: MergeCaptureScope; rows: readonly unknown[] }
	| { type: 'ATTACHMENTS'; rows: readonly unknown[] }
	| { type: 'READ_FAILED' | 'CANCEL' | 'SHUTDOWN' }

export function createAccountMergeCaptureMachine(dependencies: MergeCaptureDependencies) {
	const actors = {
		session: fromCallback<Event>(({ sendBack }) =>
			dependencies.session({
				next: (session) => sendBack({ type: 'SESSION', session }),
				error: () => sendBack({ type: 'READ_FAILED' })
			})
		),
		read: fromCallback<Event, { source: MergeDestination; scope: MergeCaptureScope }>(
			({ input, sendBack }) =>
				dependencies.read(input.source, input.scope, {
					next: (rows) => sendBack({ type: 'ROWS', scope: input.scope, rows }),
					error: () => sendBack({ type: 'READ_FAILED' })
				})
		),
		attachments: fromCallback<Event, string[]>(({ input, sendBack }) =>
			dependencies.attachments(input, {
				next: (rows) => sendBack({ type: 'ATTACHMENTS', rows }),
				error: () => sendBack({ type: 'READ_FAILED' })
			})
		),
		validate: fromPromise(({ input }: { input: unknown }) =>
			Promise.resolve(accountMergeSnapshotSchema.safeParse(input))
		)
	}
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		unknown,
		MergeCaptureResult
	>({ actors })
	const clear = workflow.assign({
		source: undefined,
		rows: {},
		attachments: undefined,
		validation: undefined
	})
	const finish = (result: (context: Context) => MergeCaptureResult) =>
		workflow.createStateConfig({
			type: 'final',
			entry: [workflow.assign({ result: ({ context }) => result(context) }), clear]
		})
	const failed = (code: Extract<MergeCaptureResult, { outcome: 'failed' }>['code']) =>
		finish(() => ({ outcome: 'failed', code }))
	return workflow.createMachine({
		id: 'account-merge-capture',
		initial: 'checkingInput',
		context: ({ input }) => {
			const parsed = mergeDestinationSchema.safeParse(input)
			return {
				source: parsed.success ? parsed.data : undefined,
				rows: {},
				attachments: undefined,
				validation: undefined,
				result: undefined
			}
		},
		output: ({ context }) => required(context.result),
		on: { CANCEL: '.cancelled', SHUTDOWN: '.closed' },
		states: {
			checkingInput: {
				always: [
					{ guard: ({ context }) => !context.source, target: 'invalidInput' },
					{ target: 'active' }
				]
			},
			active: {
				initial: 'waitingForSession',
				invoke: { src: 'session', onError: '#account-merge-capture.readFailed' },
				after: { 30000: '#account-merge-capture.timedOut' },
				on: {
					SESSION: [
						{
							guard: ({ context, event }) =>
								!event.session.ready ||
								event.session.identityId !== required(context.source).identityId ||
								event.session.organizationId !== required(context.source).organizationId ||
								event.session.binding !== dependencies.binding,
							target: '#account-merge-capture.scopeChanged'
						},
						{}
					],
					READ_FAILED: '#account-merge-capture.readFailed'
				},
				states: {
					waitingForSession: {
						on: {
							SESSION: [
								{
									guard: ({ context, event }) =>
										event.session.ready &&
										event.session.identityId === required(context.source).identityId &&
										event.session.organizationId === required(context.source).organizationId &&
										event.session.binding === dependencies.binding,
									target: 'reading'
								},
								{ target: '#account-merge-capture.scopeChanged' }
							]
						}
					},
					reading: {
						invoke: mergeCaptureScopes.map((scope) => ({
							src: 'read',
							input: ({ context }: { context: Context }) => ({
								source: required(context.source),
								scope
							}),
							onError: '#account-merge-capture.readFailed'
						})),
						on: {
							ROWS: {
								actions: assign({
									rows: ({ context, event }) => ({ ...context.rows, [event.scope]: event.rows })
								})
							}
						},
						always: {
							guard: ({ context }) =>
								mergeCaptureScopes.every((scope) => context.rows[scope] !== undefined),
							target: 'readingAttachments'
						}
					},
					readingAttachments: {
						invoke: {
							src: 'attachments',
							input: ({ context }) =>
								required(context.rows.transactions).flatMap((row) =>
									typeof row === 'object' &&
									row !== null &&
									'id' in row &&
									typeof row.id === 'string'
										? [row.id]
										: []
								),
							onError: '#account-merge-capture.readFailed'
						},
						on: {
							ATTACHMENTS: {
								target: 'validating',
								actions: assign({ attachments: ({ event }) => event.rows })
							}
						}
					},
					validating: {
						invoke: {
							src: 'validate',
							input: ({ context }: { context: Context }) => {
								const { connections, sourceOrganization, ...rows } = context.rows
								return {
									...rows,
									version: 1,
									sourceIdentityId: required(context.source).identityId,
									sourceOrganization:
										sourceOrganization?.length === 1 ? sourceOrganization[0] : undefined,
									transactionAttachments: context.attachments,
									excludedConnectionCount: connections?.length
								}
							},
							onDone: {
								target: 'classifying',
								actions: assign({ validation: ({ event }) => event.output })
							},
							onError: '#account-merge-capture.validationFailed'
						}
					},
					classifying: {
						always: [
							{
								guard: ({ context }) => context.validation?.success === true,
								target: '#account-merge-capture.captured'
							},
							{ target: '#account-merge-capture.invalid' }
						]
					}
				}
			},
			captured: finish((context) => {
				const validation = required(context.validation)
				return {
					outcome: 'captured',
					snapshot: required(validation.data) satisfies AccountMergeSnapshot
				}
			}),
			invalid: finish((context) => ({
				outcome: 'invalid',
				issues:
					required(context.validation).error?.issues.map((issue) => ({
						path: issue.path.map(String).join('.'),
						code: issue.code
					})) ?? []
			})),
			invalidInput: failed('invalid-input'),
			scopeChanged: failed('scope-changed'),
			readFailed: failed('read-failed'),
			timedOut: failed('timeout'),
			validationFailed: failed('validation-failed'),
			cancelled: finish(() => ({ outcome: 'cancelled' })),
			closed: finish(() => ({ outcome: 'closed' }))
		}
	})
}
