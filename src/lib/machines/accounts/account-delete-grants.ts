import type {
	AccountGrantWrite,
	AccountGrantNotice
} from '../../contracts/account-presentation-contract.js'
import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
import type { Account, AccountMembership, OrganizationMember } from '#lib/schema.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type DeleteGrantObservation = {
	identityId: string | null
	organizationId: string | null
	binding: object | null
	sessionReady: boolean
	loading: boolean
	failed: boolean
	membership: OrganizationMember | null | undefined
	accounts: readonly Account[]
	members: readonly OrganizationMember[]
	grants: readonly AccountMembership[]
}

export type GrantWrite = AccountGrantWrite

type Request = {
	identityId: string
	organizationId: string
	binding: object
	accountId: string
	userId: string
	canDelete: boolean
}
type Result =
	| { outcome: 'succeeded'; request: Request }
	| { outcome: 'denied'; request: Request | undefined }
	| { outcome: 'failed'; request: Request }
type Context = {
	observation: DeleteGrantObservation
	request: Request | undefined
	write: GrantWrite | undefined
	result: Result | undefined
}
type Event =
	| { type: 'OBSERVE'; observation: DeleteGrantObservation }
	| { type: 'SET_DELETE'; accountId: string; userId: string; canDelete: boolean }
	| { type: 'SHUTDOWN' }

export function canManageAccountDeleteGrants(observation: DeleteGrantObservation) {
	return (
		observation.sessionReady &&
		!!observation.binding &&
		!!observation.identityId &&
		!!observation.organizationId &&
		observation.membership?.userId === observation.identityId &&
		observation.membership.organizationId === observation.organizationId &&
		(observation.membership.role === ORGANIZATION_ROLE.OWNER ||
			observation.membership.role === ORGANIZATION_ROLE.ADMIN)
	)
}
function canManage(observation: DeleteGrantObservation, request: Request) {
	return (
		canManageAccountDeleteGrants(observation) &&
		observation.identityId === request.identityId &&
		observation.organizationId === request.organizationId &&
		observation.binding === request.binding &&
		!observation.loading &&
		!observation.failed &&
		observation.membership?.userId === request.identityId &&
		observation.membership.organizationId === request.organizationId &&
		observation.accounts.some(
			(account) =>
				account.id === request.accountId && account.organizationId === request.organizationId
		) &&
		observation.members.some(
			(member) =>
				member.userId === request.userId && member.organizationId === request.organizationId
		)
	)
}

export function createAccountDeleteGrantMachine(
	persist: (write: GrantWrite) => Promise<unknown>,
	observe: () => DeleteGrantObservation
) {
	const actors = {
		writer: createAsyncLogic<unknown, GrantWrite>({ run: ({ input }) => persist(input) })
	}
	const events0 = {
		OBSERVE: types<EventPayload<Event, 'OBSERVE'>>(),
		SET_DELETE: types<EventPayload<Event, 'SET_DELETE'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<import('xstate').OutputFrom<(typeof actors)['writer']>>
		| import('xstate').ErrorActorEvent
	const workflow = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			children: { writer: types<import('xstate').ActorRefFrom<(typeof actors)['writer']>>() }
		},
		actors,
		guards: {
			closing: (args: { value: import('xstate').StateValue }) =>
				matchesState({ operating: 'closing' }, args.value)
		}
	})
	return workflow.createMachine({
		id: 'account-delete-grants',
		initial: 'idle',
		context: () => ({
			observation: observe(),
			request: undefined,
			write: undefined,
			result: undefined
		}),
		on: {
			OBSERVE: (args) => {
				return {
					context: ((args) => ({
						observation: (({ context, event }) =>
							event.type === 'OBSERVE' ? event.observation : context.observation)(args)
					}))(args)
				}
			},
			SHUTDOWN: { target: '.closed' }
		},
		states: {
			idle: {
				on: {
					SET_DELETE: (args) => {
						return {
							target: 'assessing',
							context: ((args) => ({
								request: (({ context, event }) =>
									event.type === 'SET_DELETE'
										? {
												identityId: context.observation.identityId ?? '',
												organizationId: context.observation.organizationId ?? '',
												binding: context.observation.binding ?? {},
												accountId: event.accountId,
												userId: event.userId,
												canDelete: event.canDelete
											}
										: context.request)(args),
								result: undefined,
								write: undefined
							}))(args)
						}
					}
				}
			},
			assessing: {
				always: (args) => {
					const { context } = args
					if (!context.request || !canManage(context.observation, context.request)) {
						return {
							target: 'denied',
							context: {
								result: {
									outcome: 'denied',
									request: context.request
								}
							}
						}
					}
					if (
						!context.request?.canDelete &&
						!context.observation.grants.some(
							(grant) =>
								grant.organizationId === context.request?.organizationId &&
								grant.accountId === context.request?.accountId &&
								grant.userId === context.request?.userId
						)
					) {
						return { target: 'idle', context: { request: undefined } }
					}
					return {
						target: 'operating',
						context: {
							write: (({ context }) => {
								const request = context.request
								if (!request) throw new Error('Missing delete grant request')
								const grant = context.observation.grants.find(
									(candidate) =>
										candidate.organizationId === request.organizationId &&
										candidate.accountId === request.accountId &&
										candidate.userId === request.userId
								)
								return grant
									? { kind: 'update', grantId: grant.id, canDelete: request.canDelete }
									: {
											kind: 'insert',
											organizationId: request.organizationId,
											accountId: request.accountId,
											userId: request.userId,
											canDelete: request.canDelete
										}
							})(args)
						}
					}
				}
			},
			operating: {
				initial: 'writing',
				invoke: {
					src: 'writer',
					input: ({ context }) => required(context.write),
					onDone: (args) => {
						if (matchesState({ operating: 'closing' }, args.value)) {
							return {
								target: '#account-delete-grants.closed',
								context: { request: undefined, write: undefined }
							}
						}
						return {
							target: '#account-delete-grants.succeeded',
							context: {
								result: {
									outcome: 'succeeded',
									request: required(args.context.request)
								},
								request: undefined,
								write: undefined,
								observation: observe()
							}
						}
					},
					onError: (args) => {
						if (matchesState({ operating: 'closing' }, args.value)) {
							return { target: '#account-delete-grants.closed' }
						}
						return {
							target: '#account-delete-grants.failed',
							context: {
								result: {
									outcome: 'failed',
									request: required(args.context.request)
								},
								request: undefined,
								write: undefined,
								observation: observe()
							}
						}
					}
				},
				on: { SHUTDOWN: { target: '.closing' } },
				states: { writing: {}, closing: {} }
			},
			succeeded: {
				on: {
					SET_DELETE: (args) => {
						return {
							target: 'assessing',
							context: ((args) => ({
								request: (({ context, event }) =>
									event.type === 'SET_DELETE'
										? {
												identityId: context.observation.identityId ?? '',
												organizationId: context.observation.organizationId ?? '',
												binding: context.observation.binding ?? {},
												accountId: event.accountId,
												userId: event.userId,
												canDelete: event.canDelete
											}
										: context.request)(args),
								result: undefined,
								write: undefined
							}))(args)
						}
					}
				}
			},
			denied: {
				on: {
					SET_DELETE: (args) => {
						return {
							target: 'assessing',
							context: ((args) => ({
								request: (({ context, event }) =>
									event.type === 'SET_DELETE'
										? {
												identityId: context.observation.identityId ?? '',
												organizationId: context.observation.organizationId ?? '',
												binding: context.observation.binding ?? {},
												accountId: event.accountId,
												userId: event.userId,
												canDelete: event.canDelete
											}
										: context.request)(args),
								result: undefined,
								write: undefined
							}))(args)
						}
					}
				}
			},
			failed: {
				on: {
					SET_DELETE: (args) => {
						return {
							target: 'assessing',
							context: ((args) => ({
								request: (({ context, event }) =>
									event.type === 'SET_DELETE'
										? {
												identityId: context.observation.identityId ?? '',
												organizationId: context.observation.organizationId ?? '',
												binding: context.observation.binding ?? {},
												accountId: event.accountId,
												userId: event.userId,
												canDelete: event.canDelete
											}
										: context.request)(args),
								result: undefined,
								write: undefined
							}))(args)
						}
					}
				}
			},
			closed: { type: 'final' }
		}
	})
}

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing account delete grant operation value')
	return value
}

export type AccountDeleteGrantView = {
	busy: boolean
	canManage: boolean
	notice: AccountGrantNotice | undefined
	result: Result | undefined
}

export function selectAccountDeleteGrantView(
	snapshot: SnapshotFrom<ReturnType<typeof createAccountDeleteGrantMachine>>
): AccountDeleteGrantView {
	const busy = typeof snapshot.value === 'object' && 'operating' in snapshot.value
	const result = snapshot.context.result
	return {
		busy,
		result,
		canManage:
			snapshot.status === 'active' && canManageAccountDeleteGrants(snapshot.context.observation),
		notice: result
			? {
					key:
						result.outcome === 'succeeded'
							? 'permissions.updated'
							: result.outcome === 'failed'
								? 'permissions.update_failed'
								: 'permissions.manage_restricted',
					variant: result.outcome === 'succeeded' ? 'success' : 'error',
					accountId: result.request?.accountId ?? null
				}
			: undefined
	}
}
