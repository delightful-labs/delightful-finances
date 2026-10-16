import { assign, fromPromise, setup } from 'xstate'
import { stableUuid } from '#lib/data.js'
import { simplefinDemo } from '#lib/integrations/simplefin.js'
import type { CredentialScope } from '#lib/validation/integrations.js'
import { createIdentityMachine, required } from './identity.js'
import type { Connection, Dependencies, Observation, RequestIdentity, Result } from './types.js'

type Input = { identity: RequestIdentity; requireConnection: boolean }
export type PreparedScope = { scope: CredentialScope; connection: Connection | undefined }
type Context = Input & {
	current: Observation | undefined
	scope: CredentialScope | undefined
	error: unknown
}

export function createPreparationMachine(dependencies: Dependencies) {
	const actors = {
		identity: createIdentityMachine(dependencies),
		connectionId: fromPromise<string, { ownerId: string; organizationId: string }>(({ input }) =>
			stableUuid(
				input.ownerId,
				`${simplefinDemo ? 'simplefin-demo' : 'simplefin'}:${input.organizationId}`
			)
		)
	}
	return setup<
		Context,
		{ type: 'PREPARE' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		Result<PreparedScope>
	>({ actors }).createMachine({
		id: 'bank-preparation',
		context: ({ input }) => ({ ...input, current: undefined, scope: undefined, error: undefined }),
		initial: 'checkingIdentity',
		output: ({ context }) =>
			context.error === undefined
				? {
						ok: true,
						value: { scope: required(context.scope), connection: context.current?.connection }
					}
				: { ok: false, error: context.error },
		states: {
			checkingIdentity: {
				invoke: {
					src: 'identity',
					input: ({ context }) => context.identity,
					onDone: [
						{
							guard: ({ event }) => event.output.error !== undefined,
							target: 'failed',
							actions: assign({ error: ({ event }) => event.output.error })
						},
						{
							target: 'choosingConnection',
							actions: assign({ current: ({ event }) => event.output.current })
						}
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			choosingConnection: {
				always: [
					{
						guard: ({ context }) => Boolean(context.current?.connection),
						target: 'usingExistingConnection'
					},
					{ guard: ({ context }) => context.requireConnection, target: 'disconnected' },
					{ target: 'generatingConnectionId' }
				]
			},
			usingExistingConnection: {
				entry: assign({
					scope: ({ context }) => ({
						ownerId: required(context.current?.userId),
						organizationId: required(context.current?.organizationId),
						connectionId: required(context.current?.connection).id
					})
				}),
				always: 'prepared'
			},
			generatingConnectionId: {
				invoke: {
					src: 'connectionId',
					input: ({ context }) => ({
						ownerId: required(context.current?.userId),
						organizationId: required(context.current?.organizationId)
					}),
					onDone: {
						target: 'recheckingIdentity',
						actions: assign({
							scope: ({ context, event }) => ({
								ownerId: required(context.current?.userId),
								organizationId: required(context.current?.organizationId),
								connectionId: event.output
							})
						})
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			recheckingIdentity: {
				invoke: {
					src: 'identity',
					input: ({ context }) => context.identity,
					onDone: [
						{
							guard: ({ event }) => event.output.error !== undefined,
							target: 'failed',
							actions: assign({ error: ({ event }) => event.output.error })
						},
						{ target: 'prepared' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			prepared: { type: 'final' },
			disconnected: { type: 'final', entry: assign({ error: () => new Error('disconnected') }) },
			failed: { type: 'final' }
		}
	})
}
