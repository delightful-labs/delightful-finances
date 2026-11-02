import { and, assign, enqueueActions, raise, sendParent, sendTo, setup, stateIn } from 'xstate'
import type {
	TransferMutationScope,
	TransferScopeDrainRequest,
	TransferScopeDrainResponse,
	TransferMutationOwnerOutput
} from '../../contracts/transfer-scope-drain.js'
import type {
	InternalTransferCreateInput,
	InternalTransferCreateResult
} from './internal-transfer-create.js'
import type {
	InternalTransferLinkInput,
	InternalTransferLinkResult,
	InternalTransferUnlinkInput,
	InternalTransferUnlinkResult,
	InternalTransferDeleteInput,
	InternalTransferDeleteResult
} from './internal-transfer.js'
import { createInternalTransferCreateMachine } from './internal-transfer-create.js'
import {
	internalTransferDeleteMachine,
	internalTransferLinkMachine,
	internalTransferUnlinkMachine
} from './internal-transfer.js'

export type TransferMutationResult =
	| { operation: 'create'; result: InternalTransferCreateResult }
	| { operation: 'link'; result: InternalTransferLinkResult }
	| { operation: 'unlink'; result: InternalTransferUnlinkResult }
	| { operation: 'delete'; result: InternalTransferDeleteResult }

export type TransferMutationResponse = {
	type: 'TRANSFER_MUTATION_RESULT'
	requestId: string
	result: TransferMutationResult
}

export type TransferMutationRecipient = {
	send: (event: TransferMutationResponse) => void
}

export type TransferMutationRequest = { scope?: TransferMutationScope } & (
	| {
			requestId: string
			workspaceId: string
			operation: 'create'
			input: InternalTransferCreateInput
			recipient: TransferMutationRecipient
	  }
	| {
			requestId: string
			workspaceId: string
			operation: 'link'
			input: InternalTransferLinkInput
			recipient: TransferMutationRecipient
	  }
	| {
			requestId: string
			workspaceId: string
			operation: 'unlink'
			input: InternalTransferUnlinkInput
			recipient: TransferMutationRecipient
	  }
	| {
			requestId: string
			workspaceId: string
			operation: 'delete'
			input: InternalTransferDeleteInput
			recipient: TransferMutationRecipient
	  }
)

export type TransferMutationOwnerEvent =
	| { type: 'REQUEST_TRANSFER_MUTATION'; request: TransferMutationRequest }
	| { type: 'CANCEL_TRANSFER_MUTATION'; requestId: string }
	| { type: 'TRANSFER_SCOPE_CHANGED'; workspaceId: string | undefined }
	| { type: 'BIND_TRANSFER_SCOPE'; scope: TransferMutationScope }
	| { type: 'DRAIN_TRANSFER_SCOPE'; drain: TransferScopeDrainRequest }
	| { type: 'SHUTDOWN' }

type Context = {
	workspaceId: string | undefined
	request: TransferMutationRequest | undefined
	queue: TransferMutationRequest[]
	result: TransferMutationResponse | undefined
	scope: TransferMutationScope | undefined
	drain: TransferScopeDrainRequest | undefined
	drainResult: TransferScopeDrainResponse | undefined
	scopeResult: ScopeOutcome | undefined
	retiredDrains: WeakSet<object>
}
type Event = TransferMutationOwnerEvent | { type: 'SCOPE_RELEASED' }

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing transfer mutation request')
	return value
}

function createRequest(
	request: TransferMutationRequest | undefined
): Extract<TransferMutationRequest, { operation: 'create' }> {
	const value = required(request)
	if (value.operation !== 'create') throw new Error('Unexpected transfer mutation request')
	return value
}

function linkRequest(
	request: TransferMutationRequest | undefined
): Extract<TransferMutationRequest, { operation: 'link' }> {
	const value = required(request)
	if (value.operation !== 'link') throw new Error('Unexpected transfer mutation request')
	return value
}

function unlinkRequest(
	request: TransferMutationRequest | undefined
): Extract<TransferMutationRequest, { operation: 'unlink' }> {
	const value = required(request)
	if (value.operation !== 'unlink') throw new Error('Unexpected transfer mutation request')
	return value
}

function deleteRequest(
	request: TransferMutationRequest | undefined
): Extract<TransferMutationRequest, { operation: 'delete' }> {
	const value = required(request)
	if (value.operation !== 'delete') throw new Error('Unexpected transfer deletion request')
	return value
}

export function rejectedTransferMutation(request: TransferMutationRequest): TransferMutationResult {
	if (request.operation === 'create')
		return { operation: 'create', result: { outcome: 'scopeChanged', settlement: 'notStarted' } }
	if (request.operation === 'link')
		return { operation: 'link', result: { outcome: 'unavailable', settlement: 'notStarted' } }
	if (request.operation === 'unlink')
		return { operation: 'unlink', result: { outcome: 'unavailable', settlement: 'notStarted' } }
	return { operation: 'delete', result: { outcome: 'unavailable', settlement: 'notStarted' } }
}

function cancelled(request: TransferMutationRequest): TransferMutationResult {
	if (request.operation === 'create')
		return { operation: 'create', result: { outcome: 'cancelled', settlement: 'notStarted' } }
	if (request.operation === 'link')
		return { operation: 'link', result: { outcome: 'cancelled', settlement: 'notStarted' } }
	if (request.operation === 'unlink')
		return { operation: 'unlink', result: { outcome: 'cancelled', settlement: 'notStarted' } }
	return { operation: 'delete', result: { outcome: 'cancelled', settlement: 'notStarted' } }
}

function failure(request: TransferMutationRequest): TransferMutationResult {
	if (request.operation === 'create')
		return { operation: 'create', result: { outcome: 'unavailable', settlement: 'unresolved' } }
	if (request.operation === 'link')
		return { operation: 'link', result: { outcome: 'unavailable', settlement: 'unresolved' } }
	if (request.operation === 'unlink')
		return { operation: 'unlink', result: { outcome: 'unavailable', settlement: 'unresolved' } }
	return { operation: 'delete', result: { outcome: 'unavailable', settlement: 'unresolved' } }
}

type ScopeOutcome = Readonly<{
	outcome: TransferMutationResult['result']['outcome']
	settlement: TransferMutationResult['result']['settlement']
}>
/** Aggregate only finite outcome facts; never retain raw operation errors or SDK resources. */
function retainScopeResult(
	previous: ScopeOutcome | undefined,
	current: ScopeOutcome | undefined
): ScopeOutcome | undefined {
	if (previous?.settlement === 'unresolved') return previous
	if (current?.settlement === 'unresolved')
		return { outcome: current.outcome, settlement: current.settlement }
	if (previous?.outcome === 'recoveryRequired') return previous
	return current ? { outcome: current.outcome, settlement: current.settlement } : previous
}

function sameScope(
	left: TransferMutationScope | undefined,
	right: TransferMutationScope | undefined
) {
	return (
		left !== undefined &&
		right !== undefined &&
		left.binding === right.binding &&
		left.workspaceId === right.workspaceId &&
		left.generation === right.generation
	)
}
export function createInternalTransferMutationOwner() {
	const actors = {
		create: createInternalTransferCreateMachine(),
		link: internalTransferLinkMachine,
		unlink: internalTransferUnlinkMachine,
		delete: internalTransferDeleteMachine
	}
	const machine = setup<
		Context,
		Event,
		typeof actors,
		{
			createOperation: 'create'
			linkOperation: 'link'
			unlinkOperation: 'unlink'
			deleteOperation: 'delete'
		},
		{
			queueRequest: undefined
			rejectRequest: undefined
			rejectQueue: undefined
			cancelQueued: undefined
			removeCancelled: undefined
			reportResult: undefined
			startNext: undefined
			setWorkspace: undefined
			finishFailure: undefined
			recordScopeResult: undefined
			bindScope: undefined
			rememberDrain: undefined
			stopIssued: undefined
			rejectDrain: undefined
			replayDrain: undefined
			reportDrain: undefined
			clearCurrent: undefined
		},
		{
			creating: undefined
			linking: undefined
			unlinking: undefined
			deleting: undefined
			queuedRequestInScope: undefined
			cancelsCurrent: undefined
			activeControl: undefined
			closingControl: undefined
			workIdle: undefined
			legacyMode: undefined
			admitRequest: undefined
			freshScope: undefined
			matchingScope: undefined
			freshDrain: undefined
			sameDrain: undefined
			pendingDrain: undefined
			unresolvedResult: undefined
			unresolvedBound: undefined
			recoveryRequiredResult: undefined
		},
		never,
		string,
		unknown,
		TransferMutationOwnerOutput
	>({
		actors,
		guards: {
			activeControl: stateIn({ running: { control: 'active' } }),
			closingControl: stateIn({ running: { control: 'closing' } }),
			workIdle: stateIn({ running: { work: 'idle' } }),
			legacyMode: ({ context }) => context.scope === undefined,
			admitRequest: and([
				'activeControl',
				({ context, event }) =>
					event.type === 'REQUEST_TRANSFER_MUTATION' &&
					event.request.workspaceId === context.workspaceId &&
					(context.scope
						? sameScope(event.request.scope, context.scope) &&
							context.scopeResult?.settlement !== 'unresolved'
						: event.request.scope === undefined)
			]),
			freshScope: ({ context, event }) =>
				event.type === 'BIND_TRANSFER_SCOPE' &&
				event.scope.workspaceId.trim().length > 0 &&
				Number.isSafeInteger(event.scope.generation) &&
				event.scope.generation >= 0 &&
				context.scopeResult?.settlement !== 'unresolved' &&
				(!context.scope || event.scope.generation > context.scope.generation),
			matchingScope: ({ context, event }) =>
				event.type === 'DRAIN_TRANSFER_SCOPE' &&
				sameScope(event.drain.request.scope, context.scope),
			freshDrain: and([
				'matchingScope',
				({ context, event }) =>
					event.type === 'DRAIN_TRANSFER_SCOPE' &&
					!context.retiredDrains.has(event.drain.request.token)
			]),
			sameDrain: ({ context, event }) =>
				event.type === 'DRAIN_TRANSFER_SCOPE' &&
				event.drain.request.token === context.drain?.request.token &&
				event.drain.recipient === context.drain.recipient &&
				sameScope(event.drain.request.scope, context.drain.request.scope),
			pendingDrain: ({ context }) =>
				context.drain !== undefined && context.drainResult === undefined,
			unresolvedResult: ({ context }) => context.scopeResult?.settlement === 'unresolved',
			unresolvedBound: ({ context }) =>
				context.scope !== undefined && context.scopeResult?.settlement === 'unresolved',
			recoveryRequiredResult: ({ context }) => context.scopeResult?.outcome === 'recoveryRequired',
			creating: ({ context }) => context.request?.operation === 'create',
			linking: ({ context }) => context.request?.operation === 'link',
			unlinking: ({ context }) => context.request?.operation === 'unlink',
			deleting: ({ context }) => context.request?.operation === 'delete',
			queuedRequestInScope: and([
				'activeControl',
				({ context }) =>
					context.queue[0] !== undefined &&
					context.queue[0].workspaceId === context.workspaceId &&
					(context.scope
						? sameScope(context.queue[0].scope, context.scope)
						: context.queue[0].scope === undefined)
			]),
			cancelsCurrent: ({ context, event }) =>
				event.type === 'CANCEL_TRANSFER_MUTATION' && context.request?.requestId === event.requestId
		},
		actions: {
			recordScopeResult: assign(({ context }) => ({
				scopeResult: retainScopeResult(context.scopeResult, context.result?.result.result)
			})),
			bindScope: assign(({ event }) => {
				if (event.type !== 'BIND_TRANSFER_SCOPE') throw new Error('Missing transfer scope binding')
				return {
					scope: { ...event.scope },
					workspaceId: event.scope.workspaceId,
					drain: undefined,
					drainResult: undefined,
					scopeResult: undefined
				}
			}),
			rememberDrain: assign(({ event }) => {
				if (event.type !== 'DRAIN_TRANSFER_SCOPE') throw new Error('Missing scoped transfer drain')
				return {
					drain: {
						request: { token: event.drain.request.token, scope: { ...event.drain.request.scope } },
						recipient: event.drain.recipient
					},
					drainResult: undefined,
					workspaceId: undefined,
					queue: []
				}
			}),
			stopIssued: enqueueActions(({ self, enqueue }) => {
				const children = self.getSnapshot().children
				for (const actor of [
					children.createOperation,
					children.linkOperation,
					children.unlinkOperation,
					children.deleteOperation
				])
					if (actor?.getSnapshot().status === 'active') enqueue.sendTo(actor, { type: 'SHUTDOWN' })
			}),
			rejectDrain: ({ context, event }) => {
				if (event.type !== 'DRAIN_TRANSFER_SCOPE') return
				event.drain.recipient.send({
					type: 'TRANSFER_SCOPE_DRAIN_RESULT',
					request: event.drain.request,
					outcome: 'rejected',
					reason: !sameScope(event.drain.request.scope, context.scope)
						? 'scopeMismatch'
						: context.retiredDrains.has(event.drain.request.token)
							? 'retired'
							: 'busy'
				})
			},
			replayDrain: ({ context }) => {
				if (context.drainResult) context.drain?.recipient.send(context.drainResult)
			},
			reportDrain: ({ context }) => {
				context.retiredDrains.add(required(context.drain).request.token)
				required(context.drain).recipient.send(required(context.drainResult))
			},
			clearCurrent: assign({ request: undefined, result: undefined, queue: [] }),
			queueRequest: assign({
				queue: ({ context, event }) =>
					event.type === 'REQUEST_TRANSFER_MUTATION'
						? [...context.queue, event.request]
						: context.queue
			}),
			rejectRequest: ({ event }) => {
				if (event.type !== 'REQUEST_TRANSFER_MUTATION') return
				event.request.recipient.send({
					type: 'TRANSFER_MUTATION_RESULT',
					requestId: event.request.requestId,
					result: rejectedTransferMutation(event.request)
				})
			},
			rejectQueue: ({ context }) =>
				context.queue.forEach((request) =>
					request.recipient.send({
						type: 'TRANSFER_MUTATION_RESULT',
						requestId: request.requestId,
						result: rejectedTransferMutation(request)
					})
				),
			cancelQueued: ({ context, event }) => {
				if (event.type !== 'CANCEL_TRANSFER_MUTATION') return
				const request = context.queue.find((item) => item.requestId === event.requestId)
				if (request)
					request.recipient.send({
						type: 'TRANSFER_MUTATION_RESULT',
						requestId: request.requestId,
						result: cancelled(request)
					})
			},
			removeCancelled: assign({
				queue: ({ context, event }) =>
					event.type === 'CANCEL_TRANSFER_MUTATION'
						? context.queue.filter((item) => item.requestId !== event.requestId)
						: context.queue
			}),
			reportResult: ({ context }) => {
				if (context.result) context.request?.recipient.send(context.result)
			},
			startNext: assign({
				request: ({ context }) => context.queue[0],
				queue: ({ context }) => context.queue.slice(1),
				result: undefined
			}),
			setWorkspace: assign({
				workspaceId: ({ event }) =>
					event.type === 'TRANSFER_SCOPE_CHANGED' ? event.workspaceId : undefined
			}),
			finishFailure: assign(({ context }) => {
				const request = required(context.request)
				return {
					result: {
						type: 'TRANSFER_MUTATION_RESULT',
						requestId: request.requestId,
						result: failure(request)
					}
				}
			})
		}
	})

	return machine.createMachine({
		id: 'internal-transfer-mutation-owner',
		context: () => ({
			workspaceId: undefined,
			request: undefined,
			queue: [],
			result: undefined,
			scope: undefined,
			drain: undefined,
			drainResult: undefined,
			scopeResult: undefined,
			retiredDrains: new WeakSet<object>()
		}),
		initial: 'running',
		output: ({ context }): TransferMutationOwnerOutput =>
			context.scope
				? { outcome: 'unresolved', scope: context.scope, drain: context.drainResult?.request }
				: { outcome: 'closed' },
		states: {
			running: {
				type: 'parallel',
				on: {
					DRAIN_TRANSFER_SCOPE: [
						{ guard: 'sameDrain', actions: 'replayDrain' },
						{
							guard: and(['freshDrain', ({ context }) => context.drain === undefined]),
							actions: ['rejectQueue', 'rememberDrain', 'stopIssued']
						},
						{ actions: 'rejectDrain' }
					]
				},
				onDone: 'closed',
				states: {
					control: {
						initial: 'active',
						on: { SHUTDOWN: '.closing' },
						states: {
							active: {
								on: {
									BIND_TRANSFER_SCOPE: {
										guard: and(['legacyMode', 'workIdle', 'freshScope']),
										actions: 'bindScope'
									},
									DRAIN_TRANSFER_SCOPE: [
										{
											guard: 'freshDrain',
											target: 'draining',
											actions: ['rejectQueue', 'rememberDrain', 'stopIssued']
										},
										{ actions: 'rejectDrain' }
									]
								}
							},
							draining: {
								on: {
									DRAIN_TRANSFER_SCOPE: [{ guard: 'sameDrain' }, { actions: 'rejectDrain' }],
									SCOPE_RELEASED: 'released'
								}
							},
							released: {
								on: {
									BIND_TRANSFER_SCOPE: {
										guard: 'freshScope',
										target: 'active',
										actions: 'bindScope'
									},
									DRAIN_TRANSFER_SCOPE: [
										{ guard: 'sameDrain', actions: 'replayDrain' },
										{ actions: 'rejectDrain' }
									]
								}
							},
							closing: {
								type: 'final',
								entry: ['stopIssued', 'rejectQueue', assign({ queue: [] })],
								on: { SHUTDOWN: {} }
							}
						}
					},
					work: {
						initial: 'idle',
						states: {
							idle: {
								always: [
									{ guard: 'pendingDrain', target: 'classifyingDrain' },
									{
										guard: and(['closingControl', 'unresolvedBound']),
										target: '#internal-transfer-mutation-owner.unresolved'
									},
									{ guard: 'closingControl', target: 'stopped' }
								],
								on: {
									REQUEST_TRANSFER_MUTATION: [
										{
											guard: 'admitRequest',
											target: 'dispatching',
											actions: assign({ request: ({ event }) => event.request })
										},
										{ actions: 'rejectRequest' }
									],
									CANCEL_TRANSFER_MUTATION: { actions: ['cancelQueued', 'removeCancelled'] },
									TRANSFER_SCOPE_CHANGED: { guard: 'legacyMode', actions: 'setWorkspace' }
								}
							},
							dispatching: {
								always: [
									{ guard: 'creating', target: 'creating' },
									{ guard: 'linking', target: 'linking' },
									{ guard: 'unlinking', target: 'unlinking' },
									{ guard: 'deleting', target: 'deleting' },
									{ target: 'finishing', actions: 'finishFailure' }
								]
							},
							creating: {
								invoke: {
									id: 'createOperation',
									src: 'create',
									input: ({ context }) => createRequest(context.request).input,
									onDone: {
										target: 'finishing',
										actions: assign(({ context, event }) => ({
											result: {
												type: 'TRANSFER_MUTATION_RESULT',
												requestId: required(context.request).requestId,
												result: { operation: 'create', result: event.output }
											}
										}))
									},
									onError: { target: 'finishing', actions: 'finishFailure' }
								},
								on: {
									REQUEST_TRANSFER_MUTATION: [
										{
											guard: 'admitRequest',
											actions: 'queueRequest'
										},
										{ actions: 'rejectRequest' }
									],
									CANCEL_TRANSFER_MUTATION: [
										{
											guard: 'cancelsCurrent',
											actions: sendTo('createOperation', { type: 'SHUTDOWN' })
										},
										{ actions: ['cancelQueued', 'removeCancelled'] }
									],
									TRANSFER_SCOPE_CHANGED: {
										guard: 'legacyMode',
										actions: [
											sendTo('createOperation', { type: 'SHUTDOWN' }),
											'rejectQueue',
											'setWorkspace',
											assign({ queue: [] })
										]
									}
								}
							},
							linking: {
								invoke: {
									id: 'linkOperation',
									src: 'link',
									input: ({ context }) => linkRequest(context.request).input,
									onDone: {
										target: 'finishing',
										actions: assign(({ context, event }) => ({
											result: {
												type: 'TRANSFER_MUTATION_RESULT',
												requestId: required(context.request).requestId,
												result: { operation: 'link', result: event.output }
											}
										}))
									},
									onError: { target: 'finishing', actions: 'finishFailure' }
								},
								on: {
									REQUEST_TRANSFER_MUTATION: [
										{
											guard: 'admitRequest',
											actions: 'queueRequest'
										},
										{ actions: 'rejectRequest' }
									],
									CANCEL_TRANSFER_MUTATION: [
										{
											guard: 'cancelsCurrent',
											actions: sendTo('linkOperation', { type: 'SHUTDOWN' })
										},
										{ actions: ['cancelQueued', 'removeCancelled'] }
									],
									TRANSFER_SCOPE_CHANGED: {
										guard: 'legacyMode',
										actions: [
											sendTo('linkOperation', { type: 'SHUTDOWN' }),
											'rejectQueue',
											'setWorkspace',
											assign({ queue: [] })
										]
									}
								}
							},
							unlinking: {
								invoke: {
									id: 'unlinkOperation',
									src: 'unlink',
									input: ({ context }) => unlinkRequest(context.request).input,
									onDone: {
										target: 'finishing',
										actions: assign(({ context, event }) => ({
											result: {
												type: 'TRANSFER_MUTATION_RESULT',
												requestId: required(context.request).requestId,
												result: { operation: 'unlink', result: event.output }
											}
										}))
									},
									onError: { target: 'finishing', actions: 'finishFailure' }
								},
								on: {
									REQUEST_TRANSFER_MUTATION: [
										{
											guard: 'admitRequest',
											actions: 'queueRequest'
										},
										{ actions: 'rejectRequest' }
									],
									CANCEL_TRANSFER_MUTATION: [
										{
											guard: 'cancelsCurrent',
											actions: sendTo('unlinkOperation', { type: 'SHUTDOWN' })
										},
										{ actions: ['cancelQueued', 'removeCancelled'] }
									],
									TRANSFER_SCOPE_CHANGED: {
										guard: 'legacyMode',
										actions: [
											sendTo('unlinkOperation', { type: 'SHUTDOWN' }),
											'rejectQueue',
											'setWorkspace',
											assign({ queue: [] })
										]
									}
								}
							},
							deleting: {
								invoke: {
									id: 'deleteOperation',
									src: 'delete',
									input: ({ context }) => deleteRequest(context.request).input,
									onDone: {
										target: 'finishing',
										actions: assign(({ context, event }) => ({
											result: {
												type: 'TRANSFER_MUTATION_RESULT',
												requestId: required(context.request).requestId,
												result: { operation: 'delete', result: event.output }
											}
										}))
									},
									onError: { target: 'finishing', actions: 'finishFailure' }
								},
								on: {
									REQUEST_TRANSFER_MUTATION: [
										{
											guard: 'admitRequest',
											actions: 'queueRequest'
										},
										{ actions: 'rejectRequest' }
									],
									CANCEL_TRANSFER_MUTATION: [
										{
											guard: 'cancelsCurrent',
											actions: sendTo('deleteOperation', { type: 'SHUTDOWN' })
										},
										{ actions: ['cancelQueued', 'removeCancelled'] }
									],
									TRANSFER_SCOPE_CHANGED: {
										guard: 'legacyMode',
										actions: [
											sendTo('deleteOperation', { type: 'SHUTDOWN' }),
											'rejectQueue',
											'setWorkspace',
											assign({ queue: [] })
										]
									}
								}
							},
							finishing: {
								entry: ['recordScopeResult', 'reportResult'],
								always: [
									{ guard: 'pendingDrain', target: 'classifyingDrain' },
									{
										guard: and(['closingControl', 'unresolvedBound']),
										target: '#internal-transfer-mutation-owner.unresolved',
										actions: 'clearCurrent'
									},
									{ guard: 'closingControl', target: 'stopped', actions: 'clearCurrent' },
									{
										guard: 'unresolvedBound',
										target: 'idle',
										actions: ['rejectQueue', 'clearCurrent']
									},
									{
										guard: 'queuedRequestInScope',
										target: 'dispatching',
										actions: 'startNext'
									},
									{ target: 'idle', actions: assign({ request: undefined, result: undefined }) }
								],
								on: {
									REQUEST_TRANSFER_MUTATION: [
										{
											guard: 'admitRequest',
											actions: 'queueRequest'
										},
										{ actions: 'rejectRequest' }
									]
								}
							},
							classifyingDrain: {
								always: [
									{ guard: 'unresolvedResult', target: 'unresolvedDrain' },
									{ guard: 'recoveryRequiredResult', target: 'partialDrain' },
									{ target: 'releasedDrain' }
								]
							},
							unresolvedDrain: {
								entry: [
									assign(({ context }) => ({
										drainResult: {
											type: 'TRANSFER_SCOPE_DRAIN_RESULT',
											request: required(context.drain).request,
											outcome: 'unresolved'
										}
									})),
									'reportDrain',
									'clearCurrent'
								],
								always: '#internal-transfer-mutation-owner.unresolved'
							},
							partialDrain: {
								entry: [
									assign(({ context }) => ({
										drainResult: {
											type: 'TRANSFER_SCOPE_DRAIN_RESULT',
											request: required(context.drain).request,
											outcome: 'releasedWithFailure'
										}
									})),
									'reportDrain',
									'clearCurrent',
									raise({ type: 'SCOPE_RELEASED' })
								],
								always: [{ guard: 'closingControl', target: 'stopped' }, { target: 'idle' }]
							},
							releasedDrain: {
								entry: [
									assign(({ context }) => ({
										drainResult: {
											type: 'TRANSFER_SCOPE_DRAIN_RESULT',
											request: required(context.drain).request,
											outcome: 'released'
										}
									})),
									'reportDrain',
									'clearCurrent',
									raise({ type: 'SCOPE_RELEASED' })
								],
								always: [{ guard: 'closingControl', target: 'stopped' }, { target: 'idle' }]
							},
							stopped: { type: 'final' }
						}
					}
				}
			},
			unresolved: {
				type: 'final',
				entry: assign({
					request: undefined,
					queue: [],
					result: undefined,
					scopeResult: undefined,
					drain: undefined
				})
			},
			closed: {
				type: 'final',
				entry: [
					assign({
						workspaceId: undefined,
						scope: undefined,
						request: undefined,
						queue: [],
						result: undefined,
						scopeResult: undefined,
						drain: undefined,
						drainResult: undefined
					}),
					sendParent({ type: 'TRANSFER_MUTATION_OWNER_CLOSED' })
				]
			}
		}
	})
}
