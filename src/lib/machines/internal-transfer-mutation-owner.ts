import { assign, sendParent, sendTo, setup } from 'xstate'
import type {
	InternalTransferCreateInput,
	InternalTransferCreateResult
} from './internal-transfer-create.js'
import type {
	InternalTransferLinkInput,
	InternalTransferLinkResult,
	InternalTransferUnlinkInput,
	InternalTransferUnlinkResult
} from './internal-transfer.js'
import { createInternalTransferCreateMachine } from './internal-transfer-create.js'
import { internalTransferLinkMachine, internalTransferUnlinkMachine } from './internal-transfer.js'

export type TransferMutationResult =
	| { operation: 'create'; result: InternalTransferCreateResult }
	| { operation: 'link'; result: InternalTransferLinkResult }
	| { operation: 'unlink'; result: InternalTransferUnlinkResult }

export type TransferMutationResponse = {
	type: 'TRANSFER_MUTATION_RESULT'
	requestId: string
	result: TransferMutationResult
}

export type TransferMutationRecipient = {
	send: (event: TransferMutationResponse) => void
}

export type TransferMutationRequest =
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

export type TransferMutationOwnerEvent =
	| { type: 'REQUEST_TRANSFER_MUTATION'; request: TransferMutationRequest }
	| { type: 'CANCEL_TRANSFER_MUTATION'; requestId: string }
	| { type: 'TRANSFER_SCOPE_CHANGED'; workspaceId: string | undefined }
	| { type: 'SHUTDOWN' }

type Context = {
	workspaceId: string | undefined
	request: TransferMutationRequest | undefined
	queue: TransferMutationRequest[]
	result: TransferMutationResponse | undefined
	closing: boolean
}
type Event = TransferMutationOwnerEvent

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

function rejection(request: TransferMutationRequest): TransferMutationResult {
	if (request.operation === 'create')
		return { operation: 'create', result: { outcome: 'scopeChanged', settlement: 'notStarted' } }
	if (request.operation === 'link')
		return { operation: 'link', result: { outcome: 'unavailable', settlement: 'notStarted' } }
	return { operation: 'unlink', result: { outcome: 'unavailable', settlement: 'notStarted' } }
}

function cancelled(request: TransferMutationRequest): TransferMutationResult {
	if (request.operation === 'create')
		return { operation: 'create', result: { outcome: 'cancelled', settlement: 'notStarted' } }
	if (request.operation === 'link')
		return { operation: 'link', result: { outcome: 'cancelled', settlement: 'notStarted' } }
	return { operation: 'unlink', result: { outcome: 'cancelled', settlement: 'notStarted' } }
}

function failure(request: TransferMutationRequest): TransferMutationResult {
	if (request.operation === 'create')
		return { operation: 'create', result: { outcome: 'unavailable', settlement: 'unresolved' } }
	if (request.operation === 'link')
		return { operation: 'link', result: { outcome: 'unavailable', settlement: 'unresolved' } }
	return { operation: 'unlink', result: { outcome: 'unavailable', settlement: 'unresolved' } }
}

export function createInternalTransferMutationOwner() {
	const actors = {
		create: createInternalTransferCreateMachine(),
		link: internalTransferLinkMachine,
		unlink: internalTransferUnlinkMachine
	}
	const machine = setup<
		Context,
		Event,
		typeof actors,
		{
			createOperation: 'create'
			linkOperation: 'link'
			unlinkOperation: 'unlink'
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
		},
		{
			creating: undefined
			linking: undefined
			unlinking: undefined
			queuedRequestInScope: undefined
			cancelsCurrent: undefined
		},
		never,
		string
	>({
		actors,
		guards: {
			creating: ({ context }) => context.request?.operation === 'create',
			linking: ({ context }) => context.request?.operation === 'link',
			unlinking: ({ context }) => context.request?.operation === 'unlink',
			queuedRequestInScope: ({ context }) => context.queue[0]?.workspaceId === context.workspaceId,
			cancelsCurrent: ({ context, event }) =>
				event.type === 'CANCEL_TRANSFER_MUTATION' && context.request?.requestId === event.requestId
		},
		actions: {
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
					result: rejection(event.request)
				})
			},
			rejectQueue: ({ context }) =>
				context.queue.forEach((request) =>
					request.recipient.send({
						type: 'TRANSFER_MUTATION_RESULT',
						requestId: request.requestId,
						result: rejection(request)
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
		context: {
			workspaceId: undefined,
			request: undefined,
			queue: [],
			result: undefined,
			closing: false
		},
		initial: 'idle',
		states: {
			idle: {
				on: {
					REQUEST_TRANSFER_MUTATION: [
						{
							guard: ({ context, event }) =>
								!context.closing && event.request.workspaceId === context.workspaceId,
							target: 'dispatching',
							actions: assign({ request: ({ event }) => event.request })
						},
						{ actions: 'rejectRequest' }
					],
					CANCEL_TRANSFER_MUTATION: { actions: ['cancelQueued', 'removeCancelled'] },
					TRANSFER_SCOPE_CHANGED: { actions: 'setWorkspace' },
					SHUTDOWN: { target: 'closed', actions: assign({ closing: true }) }
				}
			},
			dispatching: {
				always: [
					{ guard: 'creating', target: 'creating' },
					{ guard: 'linking', target: 'linking' },
					{ guard: 'unlinking', target: 'unlinking' },
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
							guard: ({ context, event }) =>
								!context.closing && event.request.workspaceId === context.workspaceId,
							actions: 'queueRequest'
						},
						{ actions: 'rejectRequest' }
					],
					CANCEL_TRANSFER_MUTATION: [
						{ guard: 'cancelsCurrent', actions: sendTo('createOperation', { type: 'SHUTDOWN' }) },
						{ actions: ['cancelQueued', 'removeCancelled'] }
					],
					TRANSFER_SCOPE_CHANGED: {
						actions: [
							sendTo('createOperation', { type: 'SHUTDOWN' }),
							'rejectQueue',
							'setWorkspace',
							assign({ queue: [] })
						]
					},
					SHUTDOWN: {
						actions: [
							sendTo('createOperation', { type: 'SHUTDOWN' }),
							'rejectQueue',
							assign({ queue: [], closing: true })
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
							guard: ({ context, event }) =>
								!context.closing && event.request.workspaceId === context.workspaceId,
							actions: 'queueRequest'
						},
						{ actions: 'rejectRequest' }
					],
					CANCEL_TRANSFER_MUTATION: [
						{ guard: 'cancelsCurrent', actions: sendTo('linkOperation', { type: 'SHUTDOWN' }) },
						{ actions: ['cancelQueued', 'removeCancelled'] }
					],
					TRANSFER_SCOPE_CHANGED: {
						actions: [
							sendTo('linkOperation', { type: 'SHUTDOWN' }),
							'rejectQueue',
							'setWorkspace',
							assign({ queue: [] })
						]
					},
					SHUTDOWN: {
						actions: [
							sendTo('linkOperation', { type: 'SHUTDOWN' }),
							'rejectQueue',
							assign({ queue: [], closing: true })
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
							guard: ({ context, event }) =>
								!context.closing && event.request.workspaceId === context.workspaceId,
							actions: 'queueRequest'
						},
						{ actions: 'rejectRequest' }
					],
					CANCEL_TRANSFER_MUTATION: [
						{ guard: 'cancelsCurrent', actions: sendTo('unlinkOperation', { type: 'SHUTDOWN' }) },
						{ actions: ['cancelQueued', 'removeCancelled'] }
					],
					TRANSFER_SCOPE_CHANGED: {
						actions: [
							sendTo('unlinkOperation', { type: 'SHUTDOWN' }),
							'rejectQueue',
							'setWorkspace',
							assign({ queue: [] })
						]
					},
					SHUTDOWN: {
						actions: [
							sendTo('unlinkOperation', { type: 'SHUTDOWN' }),
							'rejectQueue',
							assign({ queue: [], closing: true })
						]
					}
				}
			},
			finishing: {
				entry: 'reportResult',
				always: [
					{
						guard: 'queuedRequestInScope',
						target: 'dispatching',
						actions: 'startNext'
					},
					{ guard: ({ context }) => context.closing, target: 'closed' },
					{ target: 'idle', actions: assign({ request: undefined, result: undefined }) }
				],
				on: {
					REQUEST_TRANSFER_MUTATION: [
						{
							guard: ({ context, event }) =>
								!context.closing && event.request.workspaceId === context.workspaceId,
							actions: 'queueRequest'
						},
						{ actions: 'rejectRequest' }
					]
				}
			},
			closed: { type: 'final', entry: sendParent({ type: 'TRANSFER_MUTATION_OWNER_CLOSED' }) }
		}
	})
}
