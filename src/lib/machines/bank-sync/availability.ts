import { assign, enqueueActions, getInitialSnapshot, raise, setup, stateIn } from 'xstate'
import type { ActorRef, Snapshot, SnapshotFrom } from 'xstate'
import { canManageBankCredentials } from '#lib/domain/organization-permissions.js'
import {
	bankEnvironment,
	type BankEnvironment,
	type BankSource,
	type Connection,
	type Observation
} from './types.js'

export type AvailabilityReport = {
	generation: number
	mode: 'restricted' | 'setup' | 'connected'
	canConnect: boolean
	canOperate: boolean
	connection: Connection | undefined
	environment: BankEnvironment
}
export type AvailabilityEvent = { type: 'AVAILABILITY_REPORTED'; report: AvailabilityReport }
type Input = BankSource & {
	generation?: number
	recipient?: ActorRef<Snapshot<unknown>, AvailabilityEvent>
}
type Context = {
	source: BankSource
	connection: Connection | undefined
	generation: number
	recipient: ActorRef<Snapshot<unknown>, AvailabilityEvent> | undefined
}
type Event =
	| { type: 'OBSERVED'; source: BankSource; generation?: number }
	| { type: 'REEVALUATE' }
	| { type: 'CHECK_CONTROLS' }
	| { type: 'SETUP_STARTED' }
	| { type: 'SETUP_ENDED' }
function selectedConnection(source: BankSource) {
	const connections = source.connections.filter(
		(row) => row.organizationId === source.organizationId && row.ownerId === source.userId
	)
	return connections.find((row) => row.status === 'active') ?? connections[0]
}

export const bankAvailabilityMachine = setup<
	Context,
	Event,
	{},
	{},
	{ publish: { mode: AvailabilityReport['mode'] } },
	{ accessAllowed: undefined; credentialReady: undefined },
	never,
	string,
	Input
>({
	actions: {
		publish: enqueueActions(
			({ context, check, enqueue }, params: { mode: AvailabilityReport['mode'] }) => {
				if (!context.recipient) return
				const allowed = check('accessAllowed')
				const connected = check('credentialReady')
				enqueue.sendTo(context.recipient, {
					type: 'AVAILABILITY_REPORTED',
					report: {
						generation: context.generation,
						mode: params.mode,
						canConnect: allowed,
						canOperate: params.mode === 'connected',
						connection: context.connection,
						environment: bankEnvironment({
							organizationId: context.source.organizationId,
							userId: context.source.userId,
							sessionReady: context.source.sessionReady,
							allowed,
							connected,
							connection: context.connection
						})
					}
				})
			}
		)
	},
	guards: {
		accessAllowed: stateIn({ access: 'allowed' }),
		credentialReady: stateIn({ credential: 'ready' })
	}
}).createMachine({
	id: 'bank-availability',
	type: 'parallel',
	context: ({ input }) => ({
		source: input,
		connection: selectedConnection(input),
		generation: input.generation ?? 0,
		recipient: input.recipient
	}),
	on: {
		OBSERVED: {
			actions: [
				assign(({ event }) => ({
					source: event.source,
					generation: event.generation ?? 0,
					connection: selectedConnection(event.source)
				})),
				raise({ type: 'REEVALUATE' })
			]
		}
	},
	states: {
		access: {
			initial: 'checkingSession',
			on: { REEVALUATE: '.checkingSession' },
			states: {
				checkingSession: {
					always: [
						{ guard: ({ context }) => !context.source.sessionReady, target: 'denied' },
						{ target: 'checkingUser' }
					]
				},
				checkingUser: {
					always: [
						{ guard: ({ context }) => !context.source.userId, target: 'denied' },
						{ target: 'checkingOrganization' }
					]
				},
				checkingOrganization: {
					always: [
						{ guard: ({ context }) => !context.source.organizationId, target: 'denied' },
						{ target: 'checkingMembership' }
					]
				},
				checkingMembership: {
					always: [
						{ guard: ({ context }) => !context.source.membership, target: 'denied' },
						{ target: 'checkingMembershipUser' }
					]
				},
				checkingMembershipUser: {
					always: [
						{
							guard: ({ context }) => context.source.membership?.userId !== context.source.userId,
							target: 'denied'
						},
						{ target: 'checkingMembershipOrganization' }
					]
				},
				checkingMembershipOrganization: {
					always: [
						{
							guard: ({ context }) =>
								context.source.membership?.organizationId !== context.source.organizationId,
							target: 'denied'
						},
						{ target: 'checkingRole' }
					]
				},
				checkingRole: {
					always: [
						{
							guard: ({ context }) =>
								canManageBankCredentials(
									context.source.membership,
									context.source.organizationId ?? ''
								),
							target: 'allowed'
						},
						{ target: 'denied' }
					]
				},
				allowed: { tags: 'allowed', entry: raise({ type: 'CHECK_CONTROLS' }) },
				denied: { entry: raise({ type: 'CHECK_CONTROLS' }) }
			}
		},
		credential: {
			initial: 'checkingConnection',
			on: { REEVALUATE: '.checkingConnection' },
			states: {
				checkingConnection: {
					always: [
						{ guard: ({ context }) => !context.connection, target: 'missing' },
						{ target: 'checkingStatus' }
					]
				},
				checkingStatus: {
					always: [
						{ guard: ({ context }) => context.connection?.status !== 'active', target: 'inactive' },
						{ target: 'checkingCiphertext' }
					]
				},
				checkingCiphertext: {
					always: [
						{ guard: ({ context }) => !context.connection?.ciphertext, target: 'incomplete' },
						{ target: 'checkingCredentialId' }
					]
				},
				checkingCredentialId: {
					always: [
						{ guard: ({ context }) => !context.connection?.credentialId, target: 'incomplete' },
						{ target: 'checkingSalt' }
					]
				},
				checkingSalt: {
					always: [
						{ guard: ({ context }) => !context.connection?.prfSalt, target: 'incomplete' },
						{ target: 'checkingIv' }
					]
				},
				checkingIv: {
					always: [
						{ guard: ({ context }) => !context.connection?.iv, target: 'incomplete' },
						{ target: 'checkingVersion' }
					]
				},
				checkingVersion: {
					always: [
						{
							guard: ({ context }) => context.connection?.credentialVersion !== 1,
							target: 'incomplete'
						},
						{ target: 'ready' }
					]
				},
				missing: { entry: raise({ type: 'CHECK_CONTROLS' }) },
				inactive: { entry: raise({ type: 'CHECK_CONTROLS' }) },
				incomplete: { entry: raise({ type: 'CHECK_CONTROLS' }) },
				ready: { tags: 'credential-ready', entry: raise({ type: 'CHECK_CONTROLS' }) }
			}
		},
		controls: {
			initial: 'checkingAccess',
			on: {
				CHECK_CONTROLS: '.checkingAccess',
				SETUP_STARTED: '.setup',
				SETUP_ENDED: '.checkingAccess'
			},
			states: {
				checkingAccess: {
					always: [
						{ guard: 'accessAllowed', target: 'checkingCredential' },
						{ target: 'restricted' }
					]
				},
				checkingCredential: {
					always: [{ guard: 'credentialReady', target: 'connected' }, { target: 'needsSetup' }]
				},
				restricted: {
					tags: 'show-restricted',
					entry: { type: 'publish', params: { mode: 'restricted' } }
				},
				connected: {
					tags: ['show-sync', 'show-connected', 'show-recovery'],
					entry: { type: 'publish', params: { mode: 'connected' } }
				},
				needsSetup: { tags: 'show-setup', entry: { type: 'publish', params: { mode: 'setup' } } },
				setup: {
					initial: 'checkingAccess',
					on: { CHECK_CONTROLS: '.checkingAccess' },
					states: {
						checkingAccess: {
							always: [{ guard: 'accessAllowed', target: 'active' }, { target: 'restricted' }]
						},
						active: { tags: 'show-setup', entry: { type: 'publish', params: { mode: 'setup' } } },
						restricted: {
							tags: 'show-restricted',
							entry: { type: 'publish', params: { mode: 'restricted' } }
						}
					}
				}
			}
		}
	}
})

export function availabilityObservation(
	snapshot: SnapshotFrom<typeof bankAvailabilityMachine>
): Observation {
	return {
		organizationId: snapshot.context.source.organizationId,
		userId: snapshot.context.source.userId,
		sessionReady: snapshot.context.source.sessionReady,
		allowed: snapshot.hasTag('allowed'),
		connected: snapshot.hasTag('credential-ready'),
		connection: snapshot.context.connection
	}
}

// Reuse guarded states when an operation needs a fresh synchronous authorization observation.
export function bankObservation(source: BankSource): Observation {
	return availabilityObservation(getInitialSnapshot(bankAvailabilityMachine, source))
}
