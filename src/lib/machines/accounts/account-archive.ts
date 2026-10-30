import { assign, sendTo, setup, stateIn, type SnapshotFrom } from 'xstate'
import { required } from '../bank-sync/identity.js'
import {
	archiveAllowed,
	archiveScopeMatches,
	createAccountArchiveOperation,
	type ArchiveObservation,
	type ArchiveRequest,
	type ArchiveResult
} from './account-archive-operation.js'

export type ArchiveRowAction = 'unavailable' | 'available' | 'disabled' | 'archiving'
export type AccountArchiveView = {
	kind: 'sessionUnavailable' | 'selectWorkspace' | 'loading' | 'loadFailed' | 'ready' | 'closed'
	rows: readonly { account: ArchiveObservation['accounts'][number]; action: ArchiveRowAction }[]
	feedback: ArchiveResult | undefined
}
type Context = {
	observation: ArchiveObservation
	request: ArchiveRequest | undefined
	result: ArchiveResult | undefined
}
type Event =
	| { type: 'OBSERVE'; observation: ArchiveObservation }
	| { type: 'ARCHIVE'; accountId: string }
	| { type: 'CANCEL' | 'SHUTDOWN' }
export function createAccountArchiveMachine(
	persist: (request: ArchiveRequest) => Promise<unknown>,
	observe: () => ArchiveObservation
) {
	const operation = createAccountArchiveOperation(persist, observe)
	const workflow = setup<
		Context,
		Event,
		{ operation: typeof operation },
		{},
		{},
		{ closing: undefined }
	>({ actors: { operation }, guards: { closing: stateIn({ operating: 'closing' }) } })
	const update = workflow.assign({
		observation: ({ context, event }) =>
			event.type === 'OBSERVE' ? event.observation : context.observation
	})
	const readiness = workflow.createStateConfig({
		initial: 'assessing',
		states: {
			assessing: {
				always: [
					{
						guard: ({ context }) =>
							!context.observation.sessionReady ||
							!context.observation.identityId ||
							!context.observation.binding,
						target: 'sessionUnavailable'
					},
					{
						guard: ({ context }) => !context.observation.organizationId,
						target: 'selectWorkspace'
					},
					{ guard: ({ context }) => context.observation.failed, target: 'loadFailed' },
					{ guard: ({ context }) => context.observation.loading, target: 'loading' },
					{ target: 'ready' }
				]
			},
			sessionUnavailable: { tags: 'sessionUnavailable' },
			selectWorkspace: { tags: 'selectWorkspace' },
			loadFailed: { tags: 'loadFailed' },
			loading: { tags: 'loading' },
			ready: {}
		}
	})
	const active = workflow.createStateConfig({
		initial: 'running',
		invoke: {
			id: 'operation',
			src: 'operation',
			input: ({ context }) => ({
				request: required(context.request),
				observation: context.observation
			}),
			onDone: [
				{ guard: 'closing', target: '#account-archive.closed' },
				{
					guard: ({ event }) => event.output.outcome === 'closed',
					target: '#account-archive.closed'
				},
				{
					target: '#account-archive.assessing',
					actions: assign({
						result: ({ event }) => event.output,
						request: undefined,
						observation: () => observe()
					})
				}
			],
			onError: [
				{
					guard: 'closing',
					target: '#account-archive.closed'
				},
				{
					target: '#account-archive.assessing',
					actions: assign({
						result: ({ context }) => ({
							outcome: 'failed',
							request: required(context.request),
							settlement: 'unknown'
						}),
						request: undefined,
						observation: () => observe()
					})
				}
			]
		},
		on: {
			OBSERVE: {
				target: '.running.assessing',
				actions: [update, sendTo('operation', ({ event }) => event)]
			},
			CANCEL: { actions: sendTo('operation', { type: 'CANCEL' }) },
			SHUTDOWN: { target: '.closing', actions: sendTo('operation', { type: 'SHUTDOWN' }) }
		},
		states: { running: readiness, closing: { on: { SHUTDOWN: {}, CANCEL: {}, OBSERVE: {} } } }
	})
	return workflow.createMachine({
		id: 'account-archive',
		initial: 'assessing',
		context: () => ({ observation: observe(), request: undefined, result: undefined }),
		on: { OBSERVE: { target: '.assessing', actions: update }, SHUTDOWN: '.closed' },
		states: {
			...readiness.states,
			ready: {
				on: {
					ARCHIVE: {
						guard: ({ event, context }) => archiveAllowed(context.observation, event.accountId),
						target: 'operating',
						actions: workflow.assign({
							request: ({ context, event }) =>
								event.type === 'ARCHIVE'
									? {
											identityId: required(context.observation.identityId),
											organizationId: required(context.observation.organizationId),
											binding: required(context.observation.binding),
											accountId: event.accountId,
											name: required(
												context.observation.accounts.find(
													(account) => account.id === event.accountId
												)
											).name
										}
									: undefined,
							result: undefined
						})
					}
				}
			},
			operating: active,
			closed: {
				type: 'final',
				entry: workflow.assign({
					request: undefined,
					result: undefined,
					observation: () => ({
						identityId: null,
						organizationId: null,
						binding: null,
						sessionReady: false,
						loading: false,
						failed: false,
						accounts: [],
						membership: undefined,
						grants: []
					})
				})
			}
		}
	})
}
export function selectAccountArchiveView(
	snapshot: SnapshotFrom<ReturnType<typeof createAccountArchiveMachine>>
): AccountArchiveView {
	const observation = snapshot.context.observation
	const active = snapshot.matches('operating')
	const kind = snapshot.matches('closed')
		? 'closed'
		: snapshot.hasTag('sessionUnavailable')
			? 'sessionUnavailable'
			: snapshot.hasTag('selectWorkspace')
				? 'selectWorkspace'
				: snapshot.hasTag('loadFailed')
					? 'loadFailed'
					: snapshot.hasTag('loading') || snapshot.matches('assessing')
						? 'loading'
						: 'ready'
	return {
		kind,
		rows: observation.accounts
			.filter((account) => account.organizationId === observation.organizationId)
			.map((account) => ({
				account,
				action: !archiveAllowed(observation, account.id)
					? 'unavailable'
					: !active
						? 'available'
						: snapshot.context.request?.accountId === account.id
							? 'archiving'
							: 'disabled'
			})),
		feedback:
			snapshot.context.result && archiveScopeMatches(snapshot.context.result.request, observation)
				? snapshot.context.result
				: undefined
	}
}
