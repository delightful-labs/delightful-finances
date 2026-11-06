import { assign, fromPromise, setup } from 'xstate'
import { providerResponseSchema } from '#lib/validation/integrations.js'
import type { z } from 'zod'
import { requestRelay } from '#lib/integrations/simplefin-relay.js'
import type { ProviderReply } from '#lib/validation/integrations.js'

export type { ProviderReply } from '#lib/validation/integrations.js'

export type ProviderRequest = {
	endpoint: string
	accessUrl: string
	discovery: boolean
	traceId: string
}
type Context = ProviderRequest & {
	response: Response | undefined
	payload: unknown
	result: ProviderReply | undefined
}

// A disposable worker owns this root. No Jazz client or passkey is opened here.
const actors = {
	request: fromPromise<Response, ProviderRequest>(({ input, signal }) =>
		requestRelay(
			input.endpoint,
			{
				operation: input.discovery ? 'discover' : 'sync',
				url: input.accessUrl
			},
			signal,
			input.traceId
		)
	),
	decode: fromPromise<unknown, Response>(({ input }) => input.json()),
	validate: fromPromise<z.output<typeof providerResponseSchema>, { payload: unknown }>(
		async ({ input }) => providerResponseSchema.parse(input.payload)
	)
}
export const providerRequestMachine = setup<
	Context,
	{ type: 'REQUEST' },
	typeof actors,
	{},
	{},
	{},
	never,
	string,
	ProviderRequest,
	ProviderReply
>({ actors }).createMachine({
	id: 'bank-provider-request',
	initial: 'requesting',
	context: ({ input }) => ({
		...input,
		response: undefined,
		payload: undefined,
		result: undefined
	}),
	output: ({ context }) => {
		if (!context.result) throw new Error('missing-provider-result')
		return context.result
	},
	states: {
		requesting: {
			invoke: {
				src: 'request',
				input: ({ context }) => context,
				onDone: [
					{
						guard: ({ event }) => !event.output.ok,
						target: 'failed',
						actions: assign({
							accessUrl: '',
							result: ({ event }) => ({ ok: false, stage: 'http', status: event.output.status })
						})
					},
					{
						target: 'decoding',
						actions: assign({ response: ({ event }) => event.output, accessUrl: '' })
					}
				],
				onError: {
					target: 'failed',
					actions: assign({ result: { ok: false, stage: 'request' } })
				}
			}
		},
		decoding: {
			invoke: {
				src: 'decode',
				input: ({ context }) => {
					if (!context.response) throw new Error('missing-provider-response')
					return context.response
				},
				onDone: {
					target: 'validating',
					actions: assign({ payload: ({ event }) => event.output, response: undefined })
				},
				onError: {
					target: 'failed',
					actions: assign({ result: { ok: false, stage: 'decode' } })
				}
			}
		},
		validating: {
			invoke: {
				src: 'validate',
				input: ({ context }) => ({ payload: context.payload }),
				onDone: {
					target: 'complete',
					actions: assign({ result: ({ event }) => ({ ok: true, response: event.output }) })
				},
				onError: {
					target: 'failed',
					actions: assign({ result: { ok: false, stage: 'validation' } })
				}
			}
		},
		complete: { type: 'final', entry: assign({ payload: undefined }) },
		failed: {
			type: 'final',
			entry: assign({ accessUrl: '', response: undefined, payload: undefined })
		}
	}
})
