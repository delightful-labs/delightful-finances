import { assign, fromPromise, raise, setup } from 'xstate'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '../schema.js'
import { switchedWorkspaceHref, workspaceHref, workspaceRoute } from '../domain/workspace-routes.js'

import type {
	WorkspaceNavigationFacts,
	NavigationRecipient,
	NavigationStatus,
	NavigationStatusEvent,
	WorkspaceNavigate
} from '../contracts/workspace-orchestration-contract.js'
export type { WorkspaceNavigationFacts } from '../contracts/workspace-orchestration-contract.js'
type Input = { facts: WorkspaceNavigationFacts; recipient: NavigationRecipient }
type Context = Input & {
	resolving: WorkspaceNavigationFacts | undefined
	destination: string | undefined
	replace: boolean
	transaction: { organizationId: string } | null
}
type Event =
	| { type: 'OBSERVED'; facts: WorkspaceNavigationFacts }
	| { type: 'SELECT'; workspaceId: string }
	| { type: 'REEVALUATE' | 'RETRY' | 'SHUTDOWN' }
export function createWorkspaceNavigationMachine(
	db: Pick<ReturnType<typeof getDb>, 'one'>,
	navigate: WorkspaceNavigate
) {
	const actors = {
		lookup: fromPromise(({ input }: { input: string }) =>
			db.one(app.transactions.where({ id: input }))
		),
		navigate: fromPromise(
			({
				input,
				signal
			}: {
				input: { destination: string; expectedHref: string; replace: boolean }
				signal: AbortSignal
			}) => navigate(input.destination, signal, input.expectedHref, input.replace)
		)
	}
	const model = setup<Context, Event, typeof actors, {}, {}, {}, never, string, Input>({
		actors
	})
	const report = (status: NavigationStatus) =>
		model.sendTo(
			({ context }) => context.recipient,
			({ context }): NavigationStatusEvent => ({
				type: 'NAVIGATION_STATUS',
				report: { generation: context.facts.generation, status }
			})
		)
	return model.createMachine({
		id: 'workspace-navigation',
		context: ({ input }) => ({
			...input,
			resolving: undefined,
			destination: undefined,
			replace: true,
			transaction: null
		}),
		initial: 'assessing',
		on: {
			SHUTDOWN: '.closed',
			SELECT: {
				target: '.navigating',
				actions: assign({
					replace: false,
					destination: ({ context, event }) =>
						switchedWorkspaceHref(
							event.workspaceId,
							context.facts.pathname,
							context.facts.search,
							context.facts.hash
						)
				})
			},
			OBSERVED: {
				actions: [assign({ facts: ({ event }) => event.facts }), raise({ type: 'REEVALUATE' })]
			},
			REEVALUATE: '.assessing',
			RETRY: '.assessing'
		},
		states: {
			assessing: {
				entry: assign({ replace: true }),
				always: [
					{
						guard: ({ context }) => !context.facts.ready,
						target: 'waiting'
					},
					{
						guard: ({ context }) => context.facts.pathname === '/settings/workspace',
						target: 'directory'
					},
					{
						guard: ({ context }) => ['/account', '/login'].includes(context.facts.pathname),
						target: 'global'
					},
					{ guard: ({ context }) => context.facts.loading, target: 'waiting' },
					{ guard: ({ context }) => context.facts.error != null, target: 'failed' },
					{
						guard: ({ context }) => workspaceRoute(context.facts.search).scoped,
						target: 'checkingScope'
					},
					{
						guard: ({ context }) =>
							/^\/(expenses|income)\/(?!new$)[^/]+$/.test(context.facts.pathname),
						target: 'resolvingLegacy'
					},
					{
						guard: ({ context }) => context.facts.organizations.length === 1,
						target: 'navigating',
						actions: assign({
							destination: ({ context }) =>
								workspaceHref(
									context.facts.organizations[0]?.id ?? null,
									`${context.facts.pathname}${context.facts.search}${context.facts.hash}`
								)
						})
					},
					{ target: 'navigating', actions: assign({ destination: '/settings/workspace' }) }
				]
			},
			checkingScope: {
				always: [
					{ guard: ({ context }) => context.facts.access === 'waiting', target: 'waiting' },
					{ guard: ({ context }) => context.facts.access === 'failed', target: 'failed' },
					{ guard: ({ context }) => context.facts.access === 'ready', target: 'scoped' },
					{ target: 'unavailable' }
				]
			},
			resolvingLegacy: {
				entry: [assign({ resolving: ({ context }) => context.facts }), report('waiting')],
				on: {
					REEVALUATE: [
						{
							guard: ({ context }) =>
								context.facts.pathname !== context.resolving?.pathname ||
								context.facts.search !== context.resolving?.search ||
								context.facts.hash !== context.resolving?.hash ||
								context.facts.userId !== context.resolving?.userId ||
								!context.facts.ready,
							target: 'assessing'
						},
						{ actions: report('waiting') }
					]
				},
				invoke: {
					src: 'lookup',
					input: ({ context }) => context.facts.pathname.split('/').at(-1) ?? '',
					onDone: {
						target: 'checkingLegacy',
						actions: assign({ transaction: ({ event }) => event.output })
					},
					onError: 'failed'
				}
			},
			checkingLegacy: {
				always: [
					{
						guard: ({ context }) =>
							context.transaction != null &&
							context.facts.organizations.some(
								(row) => row.id === context.transaction?.organizationId
							),
						target: 'navigating',
						actions: assign({
							destination: ({ context }) =>
								workspaceHref(
									context.transaction?.organizationId ?? null,
									`${context.facts.pathname}${context.facts.search}${context.facts.hash}`
								)
						})
					},
					{ target: 'unavailable' }
				]
			},
			navigating: {
				entry: [assign({ resolving: ({ context }) => context.facts }), report('waiting')],
				on: {
					REEVALUATE: [
						{
							guard: ({ context }) =>
								context.facts.userId !== context.resolving?.userId ||
								!context.facts.ready ||
								(`${context.facts.pathname}${context.facts.search}${context.facts.hash}` !==
									`${context.resolving?.pathname}${context.resolving?.search}${context.resolving?.hash}` &&
									`${context.facts.pathname}${context.facts.search}${context.facts.hash}` !==
										context.destination),
							target: 'assessing'
						},
						{ actions: report('waiting') }
					]
				},
				invoke: {
					src: 'navigate',
					input: ({ context }) => {
						if (!context.destination) throw new Error('Missing navigation destination')
						return {
							destination: context.destination,
							expectedHref: `${context.facts.pathname}${context.facts.search}${context.facts.hash}`,
							replace: context.replace
						}
					},
					onDone: [
						{
							guard: ({ context }) =>
								context.destination ===
								`${context.facts.pathname}${context.facts.search}${context.facts.hash}`,
							target: 'assessing'
						},
						{ target: 'settled' }
					],
					onError: 'failed'
				}
			},
			waiting: { entry: report('waiting') },
			directory: { entry: report('directory') },
			global: { entry: report('global') },
			scoped: { entry: report('scoped') },
			settled: { entry: report('waiting') },
			closed: { type: 'final' },
			unavailable: { entry: report('unavailable') },
			failed: { entry: report('failed') }
		}
	})
}
