import { assign, fromPromise, setup } from 'xstate'
import { app } from '#lib/schema.js'
import { canManageBankCredentials } from '#lib/domain/organization-permissions.js'
import { stableUuid } from '#lib/data.js'
import { simplefinDemo } from '#lib/integrations/simplefin.js'
import { createIdentityMachine, required } from './identity.js'
import type { AuthorizationRequest, Connection, Dependencies } from './types.js'

type Context = AuthorizationRequest & {
	demoId: string | undefined
	connection: Connection | undefined
	error: unknown
}

export function createAuthorizationMachine(dependencies: Dependencies) {
	const { db } = dependencies
	const actors = {
		identity: createIdentityMachine(dependencies),
		membership: fromPromise(({ input }: { input: AuthorizationRequest }) =>
			db.all(
				app.organizationMembers.where({
					organizationId: input.scope.organizationId,
					userId: input.scope.ownerId
				})
			)
		),
		demoId: fromPromise(({ input }: { input: AuthorizationRequest }) =>
			stableUuid(input.scope.ownerId, `simplefin-demo:${input.scope.organizationId}`)
		),
		connections: fromPromise(({ input }: { input: AuthorizationRequest }) =>
			db.all(
				app.simplefinConnections.where({
					organizationId: input.scope.organizationId,
					ownerId: input.scope.ownerId
				})
			)
		),
		connection: fromPromise(({ input }: { input: AuthorizationRequest }) =>
			db.all(
				app.simplefinConnections.where({
					id: input.scope.connectionId,
					ownerId: input.scope.ownerId,
					organizationId: input.scope.organizationId,
					status: 'active'
				})
			)
		)
	}
	return setup<
		Context,
		{ type: 'CHECK' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		AuthorizationRequest,
		{ error: unknown }
	>({ actors }).createMachine({
		id: 'bank-authorization',
		context: ({ input }) => ({
			...input,
			demoId: undefined,
			connection: undefined,
			error: undefined
		}),
		initial: 'checkingIdentity',
		output: ({ context }) => ({ error: context.error }),
		states: {
			checkingIdentity: {
				invoke: {
					src: 'identity',
					input: ({ context }) => ({
						userId: context.scope.ownerId,
						organizationId: context.scope.organizationId
					}),
					onDone: [
						{ guard: ({ event }) => event.output.error !== undefined, target: 'unauthorized' },
						{ target: 'loadingMembership' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			loadingMembership: {
				invoke: {
					src: 'membership',
					input: ({ context }) => context,
					onDone: [
						{
							guard: ({ context, event }) =>
								event.output.some((row) =>
									canManageBankCredentials(row, context.scope.organizationId)
								),
							target: 'generatingDemoId'
						},
						{ target: 'unauthorized' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			generatingDemoId: {
				invoke: {
					src: 'demoId',
					input: ({ context }) => context,
					onDone: {
						target: 'checkingRequestedMode',
						actions: assign({ demoId: ({ event }) => event.output })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			checkingRequestedMode: {
				always: [
					{
						guard: ({ context }) =>
							(context.scope.connectionId === required(context.demoId)) !== simplefinDemo,
						target: 'modeMismatch'
					},
					{ target: 'loadingConnections' }
				]
			},
			loadingConnections: {
				invoke: {
					src: 'connections',
					input: ({ context }) => context,
					onDone: [
						{
							guard: ({ context, event }) =>
								event.output.some((row) => (row.id === context.demoId) !== simplefinDemo),
							target: 'modeMismatch'
						},
						{ target: 'choosingConnectionCheck' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			choosingConnectionCheck: {
				always: [
					{ guard: ({ context }) => context.requireConnection, target: 'loadingConnection' },
					{ target: 'recheckingIdentity' }
				]
			},
			loadingConnection: {
				invoke: {
					src: 'connection',
					input: ({ context }) => context,
					onDone: {
						target: 'checkingCiphertext',
						actions: assign({ connection: ({ event }) => event.output[0] })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			checkingCiphertext: {
				always: [
					{ guard: ({ context }) => !context.connection?.ciphertext, target: 'disconnected' },
					{ target: 'checkingExpectedCiphertext' }
				]
			},
			checkingExpectedCiphertext: {
				always: [
					{ guard: ({ context }) => !context.expectedCiphertext, target: 'recheckingIdentity' },
					{
						guard: ({ context }) => context.connection?.ciphertext === context.expectedCiphertext,
						target: 'recheckingIdentity'
					},
					{ target: 'disconnected' }
				]
			},
			recheckingIdentity: {
				invoke: {
					src: 'identity',
					input: ({ context }) => ({
						userId: context.scope.ownerId,
						organizationId: context.scope.organizationId
					}),
					onDone: [
						{ guard: ({ event }) => event.output.error !== undefined, target: 'unauthorized' },
						{ target: 'authorized' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			authorized: { type: 'final' },
			unauthorized: { type: 'final', entry: assign({ error: () => new Error('unauthorized') }) },
			modeMismatch: { type: 'final', entry: assign({ error: () => new Error('mode_mismatch') }) },
			disconnected: { type: 'final', entry: assign({ error: () => new Error('disconnected') }) },
			failed: { type: 'final' }
		}
	})
}
