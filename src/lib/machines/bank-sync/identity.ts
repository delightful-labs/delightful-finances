import { assign, setup } from 'xstate'
import type { Dependencies, Observation, RequestIdentity } from './types.js'

type Context = { identity: RequestIdentity; current: Observation; error: unknown }

// Invariant narrowing at typed actor boundaries; workflow decisions belong to guards.
export function required<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new Error('invalid-machine-context')
	return value
}

export function createIdentityMachine({ observe }: Dependencies) {
	return setup<
		Context,
		{ type: 'CHECK' },
		{},
		{},
		{},
		{},
		never,
		string,
		RequestIdentity,
		{ current: Observation; error: unknown }
	>({}).createMachine({
		id: 'bank-identity',
		context: ({ input }) => ({ identity: input, current: observe(), error: undefined }),
		initial: 'checkingSession',
		output: ({ context }) => ({ current: context.current, error: context.error }),
		states: {
			checkingSession: {
				always: [
					{ guard: ({ context }) => context.current.sessionReady, target: 'checkingUser' },
					{ target: 'denied' }
				]
			},
			checkingUser: {
				always: [
					{
						guard: ({ context }) => Boolean(context.current.userId),
						target: 'checkingOrganization'
					},
					{ target: 'denied' }
				]
			},
			checkingOrganization: {
				always: [
					{
						guard: ({ context }) => Boolean(context.current.organizationId),
						target: 'checkingPermission'
					},
					{ target: 'denied' }
				]
			},
			checkingPermission: {
				always: [
					{ guard: ({ context }) => context.current.allowed, target: 'checkingRequestedUser' },
					{ target: 'denied' }
				]
			},
			checkingRequestedUser: {
				always: [
					{
						guard: ({ context }) => context.current.userId === context.identity.userId,
						target: 'checkingRequestedOrganization'
					},
					{ target: 'denied' }
				]
			},
			checkingRequestedOrganization: {
				always: [
					{
						guard: ({ context }) =>
							context.current.organizationId === context.identity.organizationId,
						target: 'checkingConnection'
					},
					{ target: 'denied' }
				]
			},
			checkingConnection: {
				always: [
					{ guard: ({ context }) => !context.current.connection, target: 'authorized' },
					{ target: 'checkingConnectionOwner' }
				]
			},
			checkingConnectionOwner: {
				always: [
					{
						guard: ({ context }) => context.current.connection?.ownerId === context.current.userId,
						target: 'checkingConnectionOrganization'
					},
					{ target: 'denied' }
				]
			},
			checkingConnectionOrganization: {
				always: [
					{
						guard: ({ context }) =>
							context.current.connection?.organizationId === context.current.organizationId,
						target: 'authorized'
					},
					{ target: 'denied' }
				]
			},
			authorized: { type: 'final' },
			denied: { type: 'final', entry: assign({ error: () => new Error('unauthorized') }) }
		}
	})
}
