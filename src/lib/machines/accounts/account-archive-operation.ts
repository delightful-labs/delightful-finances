import { assign, fromPromise, setup, stateIn } from 'xstate'
import type { Account, OrganizationMember } from '#lib/schema.js'
import { canWriteAccount } from '#lib/domain/organization-permissions.js'
import { accountArchiveSchema } from '#lib/validation/accounts.js'

export type ArchiveObservation = {
	identityId: string | null
	organizationId: string | null
	binding: object | null
	sessionReady: boolean
	loading: boolean
	failed: boolean
	accounts: readonly Account[]
	membership: OrganizationMember | null | undefined
	grants: readonly {
		organizationId: string
		userId: string
		accountId: string
		access: 'read' | 'write'
	}[]
}
export type ArchiveRequest = {
	identityId: string
	organizationId: string
	binding: object
	accountId: string
	name: string
}
export type ArchiveResult =
	| { outcome: 'succeeded'; request: ArchiveRequest; settlement: 'locallyPersisted' }
	| {
			outcome: 'invalid' | 'denied' | 'unavailable'
			request: ArchiveRequest
			settlement: 'notStarted'
	  }
	| { outcome: 'failed'; request: ArchiveRequest; settlement: 'rejected' | 'unknown' }
	| {
			outcome: 'scopeChanged' | 'cancelled' | 'closed'
			request: ArchiveRequest
			settlement: 'notStarted' | 'locallyPersisted' | 'rejected'
	  }

type Input = { request: ArchiveRequest; observation: ArchiveObservation }
type Context = Input & { result: ArchiveResult | undefined }
type Event = { type: 'OBSERVE'; observation: ArchiveObservation } | { type: 'CANCEL' | 'SHUTDOWN' }

export function archiveScopeMatches(request: ArchiveRequest, observation: ArchiveObservation) {
	return (
		request.identityId === observation.identityId &&
		request.organizationId === observation.organizationId &&
		request.binding === observation.binding &&
		observation.sessionReady
	)
}
export function archiveAllowed(observation: ArchiveObservation, accountId: string) {
	return (
		observation.sessionReady &&
		!!observation.identityId &&
		!!observation.organizationId &&
		!!observation.binding &&
		!observation.loading &&
		!observation.failed &&
		observation.membership?.userId === observation.identityId &&
		observation.accounts.some(
			(account) =>
				account.id === accountId &&
				account.organizationId === observation.organizationId &&
				!account.archivedAt
		) &&
		canWriteAccount(
			observation.membership,
			observation.organizationId,
			accountId,
			observation.grants.filter(
				(grant) =>
					grant.userId === observation.identityId &&
					grant.organizationId === observation.organizationId
			)
		)
	)
}

export function createAccountArchiveOperation(
	persist: (request: ArchiveRequest) => Promise<unknown>,
	observe: () => ArchiveObservation
) {
	const actors = { persist: fromPromise<unknown, ArchiveRequest>(({ input }) => persist(input)) }
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{ shuttingDown: undefined; scopeChanged: undefined; cancelling: undefined },
		never,
		string,
		Input,
		ArchiveResult
	>({
		actors,
		guards: {
			shuttingDown: stateIn({ writing: 'settlingShutdown' }),
			scopeChanged: stateIn({ writing: 'settlingScopeChange' }),
			cancelling: stateIn({ writing: 'settlingCancellation' })
		}
	})
	const observeEvent = workflow.assign({
		observation: ({ event }) => (event.type === 'OBSERVE' ? event.observation : observe())
	})
	const finish = (outcome: 'invalid' | 'denied' | 'unavailable') =>
		workflow.createStateConfig({
			type: 'final',
			entry: workflow.assign({
				result: ({ context }) => ({ outcome, request: context.request, settlement: 'notStarted' })
			})
		})
	return workflow.createMachine({
		id: 'account-archive-operation',
		initial: 'validating',
		context: ({ input }) => ({ ...input, result: undefined }),
		output: ({ context }) => {
			if (!context.result) throw new Error('Missing archive result')
			return context.result
		},
		on: { CANCEL: '.cancelled', SHUTDOWN: '.closed', OBSERVE: { actions: observeEvent } },
		states: {
			validating: {
				always: [
					{
						guard: ({ context }) =>
							accountArchiveSchema.safeParse({
								accountId: context.request.accountId,
								organizationId: context.request.organizationId
							}).success,
						target: 'authorizing'
					},
					{ target: 'invalid' }
				]
			},
			authorizing: {
				entry: assign({ observation: () => observe() }),
				always: [
					{
						guard: ({ context }) => !archiveScopeMatches(context.request, context.observation),
						target: 'scopeChanged'
					},
					{
						guard: ({ context }) =>
							context.observation.loading ||
							context.observation.failed ||
							!context.observation.accounts.some(
								(account) => account.id === context.request.accountId
							),
						target: 'unavailable'
					},
					{
						guard: ({ context }) => !archiveAllowed(context.observation, context.request.accountId),
						target: 'denied'
					},
					{ target: 'writing' }
				]
			},
			writing: {
				initial: 'persisting',
				invoke: {
					src: 'persist',
					input: ({ context }) => context.request,
					onDone: [
						{
							guard: 'shuttingDown',
							target: 'closed',
							actions: assign({
								result: ({ context }) => ({
									outcome: 'closed',
									request: context.request,
									settlement: 'locallyPersisted'
								})
							})
						},
						{
							guard: 'scopeChanged',
							target: 'scopeChanged',
							actions: assign({
								result: ({ context }) => ({
									outcome: 'scopeChanged',
									request: context.request,
									settlement: 'locallyPersisted'
								})
							})
						},
						{
							guard: 'cancelling',
							target: 'cancelled',
							actions: assign({
								result: ({ context }) => ({
									outcome: 'cancelled',
									request: context.request,
									settlement: 'locallyPersisted'
								})
							})
						},
						{
							target: 'succeeded',
							actions: assign({
								result: ({ context }) => ({
									outcome: 'succeeded',
									request: context.request,
									settlement: 'locallyPersisted'
								})
							})
						}
					],
					onError: [
						{
							guard: 'shuttingDown',
							target: 'closed',
							actions: assign({
								result: ({ context }) => ({
									outcome: 'closed',
									request: context.request,
									settlement: 'rejected'
								})
							})
						},
						{
							guard: 'scopeChanged',
							target: 'scopeChanged',
							actions: assign({
								result: ({ context }) => ({
									outcome: 'scopeChanged',
									request: context.request,
									settlement: 'rejected'
								})
							})
						},
						{
							guard: 'cancelling',
							target: 'cancelled',
							actions: assign({
								result: ({ context }) => ({
									outcome: 'cancelled',
									request: context.request,
									settlement: 'rejected'
								})
							})
						},
						{
							target: 'failed',
							actions: assign({
								result: ({ context }) => ({
									outcome: 'failed',
									request: context.request,
									settlement: 'rejected'
								})
							})
						}
					]
				},
				on: { SHUTDOWN: '.settlingShutdown', CANCEL: '.settlingCancellation' },
				states: {
					persisting: {
						on: {
							OBSERVE: [
								{
									guard: ({ context, event }) =>
										!archiveScopeMatches(context.request, event.observation),
									target: 'settlingScopeChange',
									actions: observeEvent
								},
								{
									guard: ({ context, event }) =>
										event.observation.loading ||
										event.observation.failed ||
										event.observation.membership?.userId !== context.request.identityId ||
										!canWriteAccount(
											event.observation.membership,
											context.request.organizationId,
											context.request.accountId,
											event.observation.grants.filter(
												(grant) =>
													grant.organizationId === context.request.organizationId &&
													grant.userId === context.request.identityId
											)
										),
									target: 'settlingScopeChange',
									actions: observeEvent
								},
								{ actions: observeEvent }
							]
						}
					},
					settlingCancellation: {
						tags: 'cancelling',
						on: { CANCEL: {}, OBSERVE: { actions: observeEvent } }
					},
					settlingScopeChange: {
						tags: 'scopeChanged',
						on: { CANCEL: {}, OBSERVE: { actions: observeEvent } }
					},
					settlingShutdown: { tags: 'shuttingDown', on: { CANCEL: {}, SHUTDOWN: {}, OBSERVE: {} } }
				}
			},
			succeeded: { type: 'final' },
			failed: { type: 'final' },
			invalid: finish('invalid'),
			denied: finish('denied'),
			unavailable: finish('unavailable'),
			scopeChanged: {
				type: 'final',
				entry: workflow.assign({
					result: ({ context }) =>
						context.result ?? {
							outcome: 'scopeChanged',
							request: context.request,
							settlement: 'notStarted'
						}
				})
			},
			cancelled: {
				type: 'final',
				entry: workflow.assign({
					result: ({ context }) =>
						context.result ?? {
							outcome: 'cancelled',
							request: context.request,
							settlement: 'notStarted'
						}
				})
			},
			closed: {
				type: 'final',
				entry: workflow.assign({
					result: ({ context }) =>
						context.result ?? {
							outcome: 'closed',
							request: context.request,
							settlement: 'notStarted'
						}
				})
			}
		}
	})
}
