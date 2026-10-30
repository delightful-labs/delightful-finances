import { assign, setup } from 'xstate'
import type {
	TransferMutationRecipient,
	TransferMutationRequest,
	TransferMutationResponse,
	TransferMutationResult
} from './internal-transfer-mutation-owner.js'

export type TransferMutationGateway = {
	send: (
		event:
			| { type: 'TRANSFER_MUTATION_REQUEST'; request: TransferMutationRequest }
			| { type: 'CANCEL_TRANSFER_MUTATION'; requestId: string }
	) => void
}

export type TransferMutationRequestInput = TransferMutationRequest extends infer Request
	? Request extends TransferMutationRequest
		? Omit<Request, 'recipient' | 'requestId'>
		: never
	: never

type Context = {
	request: TransferMutationRequestInput
	requestId: string
	result: TransferMutationResult | undefined
}
type Event = TransferMutationResponse | { type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN' }

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing transfer mutation result')
	return value
}

export function createTransferMutationRequestMachine(gateway: TransferMutationGateway) {
	const machine = setup<
		Context,
		Event,
		{},
		{},
		{ submit: undefined; cancel: undefined },
		{ matchingResponse: undefined },
		never,
		string,
		TransferMutationRequestInput,
		TransferMutationResult
	>({
		guards: {
			matchingResponse: ({ context, event }) =>
				event.type === 'TRANSFER_MUTATION_RESULT' && event.requestId === context.requestId
		},
		actions: {
			submit: ({ context, self }) => {
				const recipient: TransferMutationRecipient = {
					send: (event) => self.send(event)
				}
				gateway.send({
					type: 'TRANSFER_MUTATION_REQUEST',
					request: { ...context.request, requestId: self.id, recipient }
				})
			},
			cancel: ({ context }) =>
				gateway.send({
					type: 'CANCEL_TRANSFER_MUTATION',
					requestId: context.requestId
				})
		}
	})
	return machine.createMachine({
		id: 'transfer-mutation-request',
		context: ({ input, self }) => ({ request: input, requestId: self.id, result: undefined }),
		initial: 'waiting',
		output: ({ context }) => required(context.result),
		states: {
			waiting: {
				entry: 'submit',
				on: {
					TRANSFER_MUTATION_RESULT: {
						guard: 'matchingResponse',
						target: 'complete',
						actions: assign({ result: ({ event }) => event.result })
					},
					CANCEL: { target: 'cancelling', actions: 'cancel' },
					INVALIDATE: { target: 'cancelling', actions: 'cancel' },
					SHUTDOWN: { target: 'cancelling', actions: 'cancel' }
				}
			},
			cancelling: {
				on: {
					TRANSFER_MUTATION_RESULT: {
						guard: 'matchingResponse',
						target: 'complete',
						actions: assign({ result: ({ event }) => event.result })
					}
				}
			},
			complete: { type: 'final' }
		}
	})
}
