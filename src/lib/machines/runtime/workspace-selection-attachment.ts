import { assign, sendTo, setup, stateIn } from 'xstate'
import type { ActorRef, Snapshot } from 'xstate'
import { createWorkspaceSelectionMachine } from 'delightful-local-first/workspace/workflow'
import type {
	WorkspaceSelectionEvent,
	WorkspaceSelectionOutput,
	WorkspaceSelectionReport,
	WorkspaceSelectionScope
} from 'delightful-local-first/workspace/contracts'
import { required } from '../bank-sync/identity.js'

export type WorkspaceSelectionBinding = Readonly<{
	scope: WorkspaceSelectionScope
	revision: number
}>
type Failure =
	| { reason: 'unresolved'; result: Extract<WorkspaceSelectionOutput, { outcome: 'unresolved' }> }
	| { reason: 'childCrashed' | 'unexpectedClosure' }
export type WorkspaceSelectionAttachmentReport =
	| WorkspaceSelectionReport
	| {
			type: 'WORKSPACE_SELECTION_ATTACHED'
			binding: WorkspaceSelectionBinding
	  }
	| { type: 'WORKSPACE_SELECTION_RELEASED'; binding: WorkspaceSelectionBinding }
	| {
			type: 'WORKSPACE_SELECTION_ATTACHMENT_FAILED'
			binding: WorkspaceSelectionBinding
			failure: Failure
	  }
type Command = Exclude<WorkspaceSelectionEvent, { type: 'BIND' | 'SHUTDOWN' }>
export type WorkspaceSelectionAttachmentEvent =
	| { type: 'ATTACH'; binding: WorkspaceSelectionBinding }
	| { type: 'DETACH'; binding: WorkspaceSelectionBinding }
	| { type: 'SELECTION_COMMAND'; binding: WorkspaceSelectionBinding; command: Command }
	| { type: 'SHUTDOWN' }
type Input = {
	reportTo: ActorRef<Snapshot<unknown>, WorkspaceSelectionAttachmentReport>
}
type Context = Input & {
	binding: WorkspaceSelectionBinding | undefined
	pending: WorkspaceSelectionBinding | undefined
	revision: number
	usedAttachments: WeakSet<object>
	failure: Failure | undefined
}
export type WorkspaceSelectionAttachmentOutput =
	| { outcome: 'closed' }
	| { outcome: 'failed'; binding: WorkspaceSelectionBinding; failure: Failure }

function sameBinding(
	left: WorkspaceSelectionBinding,
	right: WorkspaceSelectionBinding | undefined
) {
	return (
		left.revision === right?.revision &&
		left.scope.binding === right.scope.binding &&
		left.scope.attachment === right.scope.attachment
	)
}
function capture(binding: WorkspaceSelectionBinding): WorkspaceSelectionBinding {
	return { revision: binding.revision, scope: { ...binding.scope } }
}

/** Owns fixed-scope selection replacement; the application owns and acknowledges resource drain. */
export function createWorkspaceSelectionAttachmentMachine() {
	const actors = { selection: createWorkspaceSelectionMachine() }
	const model = setup<
		Context,
		WorkspaceSelectionAttachmentEvent,
		typeof actors,
		{},
		{ reportReleased: undefined },
		{ freshBinding: undefined; currentBinding: undefined; closing: undefined },
		never,
		string,
		Input,
		WorkspaceSelectionAttachmentOutput
	>({
		actors,
		actions: {
			reportReleased: sendTo(
				({ context }) => context.reportTo,
				({ context }): WorkspaceSelectionAttachmentReport => ({
					type: 'WORKSPACE_SELECTION_RELEASED',
					binding: required(context.binding)
				})
			)
		},
		guards: {
			freshBinding: ({ context, event }) =>
				event.type === 'ATTACH' &&
				Number.isSafeInteger(event.binding.revision) &&
				event.binding.revision >= 0 &&
				event.binding.revision > context.revision &&
				!context.usedAttachments.has(event.binding.scope.attachment),
			currentBinding: ({ context, event }) =>
				(event.type === 'DETACH' || event.type === 'SELECTION_COMMAND') &&
				sameBinding(event.binding, context.binding),
			closing: stateIn({ holding: 'closing' })
		}
	})
	const rememberPending = model.assign(({ event }) => {
		if (event.type !== 'ATTACH') throw new Error('Missing selection attachment')
		return { pending: capture(event.binding), revision: event.binding.revision }
	})
	const forward = model.sendTo('selection', ({ event }) => {
		if (event.type !== 'SELECTION_COMMAND') throw new Error('Missing selection command')
		return event.command
	})
	const drainCommands = model.createStateConfig({
		on: {
			SELECTION_COMMAND: {
				guard: ({ context, event }) =>
					sameBinding(event.binding, context.binding) &&
					(event.command.type === 'DRAINED' || event.command.type === 'DRAIN_FAILED'),
				actions: forward
			}
		}
	})
	return model.createMachine({
		id: 'workspace-selection-attachment',
		initial: 'unbound',
		context: ({ input }) => ({
			...input,
			binding: undefined,
			pending: undefined,
			revision: -1,
			usedAttachments: new WeakSet(),
			failure: undefined
		}),
		output: ({ context }) =>
			context.failure
				? { outcome: 'failed', binding: required(context.binding), failure: context.failure }
				: { outcome: 'closed' },
		states: {
			unbound: {
				entry: assign({ binding: undefined, pending: undefined }),
				on: {
					ATTACH: { guard: 'freshBinding', target: 'installing', actions: rememberPending },
					SHUTDOWN: 'closed'
				}
			},
			installing: {
				entry: assign(({ context }) => {
					const binding = required(context.pending)
					context.usedAttachments.add(binding.scope.attachment)
					return { binding, pending: undefined }
				}),
				always: 'holding'
			},
			holding: {
				initial: 'active',
				invoke: {
					id: 'selection',
					src: 'selection',
					input: ({ context }) => ({ reportTo: context.reportTo }),
					onDone: [
						{
							guard: ({ event }) => event.output.outcome === 'unresolved',
							target: 'failed',
							actions: assign(({ event }) => {
								if (event.output.outcome !== 'unresolved') throw new Error('Missing failure')
								return { failure: { reason: 'unresolved', result: event.output } satisfies Failure }
							})
						},
						{ guard: 'closing', target: 'closed', actions: 'reportReleased' },
						{
							guard: stateIn({ holding: 'replacing' }),
							target: 'released',
							actions: 'reportReleased'
						},
						{
							target: 'failed',
							actions: assign({ failure: { reason: 'unexpectedClosure' } })
						}
					],
					onError: { target: 'failed', actions: assign({ failure: { reason: 'childCrashed' } }) }
				},
				states: {
					active: {
						entry: [
							sendTo(
								({ context }) => context.reportTo,
								({ context }): WorkspaceSelectionAttachmentReport => ({
									type: 'WORKSPACE_SELECTION_ATTACHED',
									binding: required(context.binding)
								})
							),
							sendTo('selection', ({ context }) => ({
								type: 'BIND',
								scope: required(context.binding).scope
							}))
						],
						on: {
							ATTACH: { guard: 'freshBinding', target: 'replacing', actions: rememberPending },
							DETACH: { guard: 'currentBinding', target: 'replacing' },
							SELECTION_COMMAND: { guard: 'currentBinding', actions: forward },
							SHUTDOWN: 'closing'
						}
					},
					replacing: {
						...drainCommands,
						entry: sendTo('selection', { type: 'SHUTDOWN' }),
						on: {
							...drainCommands.on,
							ATTACH: { guard: 'freshBinding', actions: rememberPending },
							DETACH: {
								guard: ({ context, event }) => sameBinding(event.binding, context.pending),
								actions: assign({ pending: undefined })
							},
							SHUTDOWN: 'closing'
						}
					},
					closing: {
						...drainCommands,
						entry: [assign({ pending: undefined }), sendTo('selection', { type: 'SHUTDOWN' })]
					}
				}
			},
			released: {
				always: [
					{ guard: ({ context }) => context.pending !== undefined, target: 'installing' },
					{ target: 'unbound' }
				]
			},
			closed: { type: 'final', entry: assign({ binding: undefined, pending: undefined }) },
			failed: {
				type: 'final',
				entry: [
					assign({ pending: undefined }),
					sendTo(
						({ context }) => context.reportTo,
						({ context }): WorkspaceSelectionAttachmentReport => ({
							type: 'WORKSPACE_SELECTION_ATTACHMENT_FAILED',
							binding: required(context.binding),
							failure: required(context.failure)
						})
					)
				]
			}
		}
	})
}
