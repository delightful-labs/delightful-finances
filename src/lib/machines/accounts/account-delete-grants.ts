import { assign, fromPromise, setup, stateIn, type SnapshotFrom } from 'xstate'
import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
import type { Account, AccountMembership, OrganizationMember } from '#lib/schema.js'

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

export type GrantWrite =
	| { kind: 'update'; grantId: string; canDelete: boolean }
	| {
			kind: 'insert'
			organizationId: string
			accountId: string
			userId: string
			canDelete: boolean
	  }
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

function canManage(observation: DeleteGrantObservation, request: Request) {
	const role = observation.membership?.role
	return (
		observation.sessionReady &&
		observation.identityId === request.identityId &&
		observation.organizationId === request.organizationId &&
		observation.binding === request.binding &&
		!observation.loading &&
		!observation.failed &&
		observation.membership?.userId === request.identityId &&
		observation.membership.organizationId === request.organizationId &&
		(role === ORGANIZATION_ROLE.OWNER || role === ORGANIZATION_ROLE.ADMIN) &&
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
	const actors = { writer: fromPromise<unknown, GrantWrite>(({ input }) => persist(input)) }
	const workflow = setup<Context, Event, typeof actors, {}, {}, { closing: undefined }>({
		actors,
		guards: { closing: stateIn({ operating: 'closing' }) }
	})
	const update = workflow.assign({
		observation: ({ context, event }) =>
			event.type === 'OBSERVE' ? event.observation : context.observation
	})
	const requestGrant = workflow.assign({
		request: ({ context, event }) =>
			event.type === 'SET_DELETE'
				? {
						identityId: context.observation.identityId ?? '',
						organizationId: context.observation.organizationId ?? '',
						binding: context.observation.binding ?? {},
						accountId: event.accountId,
						userId: event.userId,
						canDelete: event.canDelete
					}
				: context.request,
		result: undefined,
		write: undefined
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
			OBSERVE: { actions: update },
			SHUTDOWN: '.closed'
		},
		states: {
			idle: {
				on: {
					SET_DELETE: { target: 'assessing', actions: requestGrant }
				}
			},
			assessing: {
				always: [
					{
						guard: ({ context }) =>
							!context.request || !canManage(context.observation, context.request),
						target: 'denied',
						actions: workflow.assign({
							result: ({ context }) => ({
								outcome: 'denied',
								request: context.request
							})
						})
					},
					{
						guard: ({ context }) =>
							!context.request?.canDelete &&
							!context.observation.grants.some(
								(grant) =>
									grant.organizationId === context.request?.organizationId &&
									grant.accountId === context.request?.accountId &&
									grant.userId === context.request?.userId
							),
						target: 'idle',
						actions: workflow.assign({ request: undefined })
					},
					{
						target: 'operating',
						actions: workflow.assign({
							write: ({ context }) => {
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
							}
						})
					}
				]
			},
			operating: {
				initial: 'writing',
				invoke: {
					src: 'writer',
					input: ({ context }) => required(context.write),
					onDone: [
						{
							guard: 'closing',
							target: '#account-delete-grants.closed',
							actions: assign({ request: undefined, write: undefined })
						},
						{
							target: '#account-delete-grants.succeeded',
							actions: assign({
								result: ({ context }) => ({
									outcome: 'succeeded',
									request: required(context.request)
								}),
								request: undefined,
								write: undefined,
								observation: () => observe()
							})
						}
					],
					onError: [
						{ guard: 'closing', target: '#account-delete-grants.closed' },
						{
							target: '#account-delete-grants.failed',
							actions: assign({
								result: ({ context }) => ({
									outcome: 'failed',
									request: required(context.request)
								}),
								request: undefined,
								write: undefined,
								observation: () => observe()
							})
						}
					]
				},
				on: { SHUTDOWN: { target: '.closing' } },
				states: { writing: {}, closing: {} }
			},
			succeeded: { on: { SET_DELETE: { target: 'assessing', actions: requestGrant } } },
			denied: { on: { SET_DELETE: { target: 'assessing', actions: requestGrant } } },
			failed: { on: { SET_DELETE: { target: 'assessing', actions: requestGrant } } },
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
	result: Result | undefined
}

export function selectAccountDeleteGrantView(
	snapshot: SnapshotFrom<ReturnType<typeof createAccountDeleteGrantMachine>>
): AccountDeleteGrantView {
	const busy = typeof snapshot.value === 'object' && 'operating' in snapshot.value
	return { busy, result: snapshot.context.result }
}
