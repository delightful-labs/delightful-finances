import { assign, fromCallback, setup } from 'xstate'
import type {
	MergeDestination,
	MergeDestinationDependencies,
	MergeDestinationError,
	MergeDestinationMembership,
	MergeDestinationOrganization,
	MergeDestinationResult,
	MergeDestinationSession
} from '#lib/schema/account-merge-destination.js'
import { mergeDestinationSchema } from '#lib/validation/account-merge-journal.js'
import { required } from '../bank-sync/identity.js'

type Context = {
	destination: MergeDestination | undefined
	session: MergeDestinationSession | undefined
	organizations: readonly MergeDestinationOrganization[] | undefined
	memberships: readonly MergeDestinationMembership[] | undefined
	result: MergeDestinationResult | undefined
}
type Event =
	| { type: 'SESSION'; session: MergeDestinationSession }
	| { type: 'ORGANIZATIONS'; rows: readonly MergeDestinationOrganization[] }
	| { type: 'MEMBERSHIPS'; rows: readonly MergeDestinationMembership[] }
	| { type: 'READ_FAILED' | 'SESSION_FAILED' | 'CANCEL' | 'SHUTDOWN' }

// Subscription bindings stay in integration. Callback adapters own disposal and
// bridge later native errors; invoke.onError handles subscription startup errors.
export function createAccountMergeDestinationMachine(dependencies: MergeDestinationDependencies) {
	const actors = {
		session: fromCallback<Event>(({ sendBack }) =>
			dependencies.session({
				next: (session) => sendBack({ type: 'SESSION', session }),
				error: () => sendBack({ type: 'SESSION_FAILED' })
			})
		),
		organization: fromCallback<Event, MergeDestination>(({ input, sendBack }) =>
			dependencies.organization(input, {
				next: (rows) => sendBack({ type: 'ORGANIZATIONS', rows }),
				error: () => sendBack({ type: 'READ_FAILED' })
			})
		),
		membership: fromCallback<Event, MergeDestination>(({ input, sendBack }) =>
			dependencies.membership(input, {
				next: (rows) => sendBack({ type: 'MEMBERSHIPS', rows }),
				error: () => sendBack({ type: 'READ_FAILED' })
			})
		)
	}
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		unknown,
		MergeDestinationResult
	>({ actors })
	const clear = workflow.assign({
		destination: undefined,
		session: undefined,
		organizations: undefined,
		memberships: undefined
	})
	const finish = (result: (context: Context) => MergeDestinationResult) =>
		workflow.createStateConfig({
			type: 'final',
			entry: [workflow.assign({ result: ({ context }) => result(context) }), clear]
		})
	const failed = (code: MergeDestinationError) => finish(() => ({ outcome: 'failed', code }))
	return workflow.createMachine({
		id: 'account-merge-destination',
		initial: 'validating',
		context: ({ input }) => {
			const parsed = mergeDestinationSchema.safeParse(input)
			return {
				destination: parsed.success ? parsed.data : undefined,
				session: undefined,
				organizations: undefined,
				memberships: undefined,
				result: undefined
			}
		},
		output: ({ context }) => required(context.result),
		on: { CANCEL: '.cancelled', SHUTDOWN: '.closed' },
		states: {
			validating: {
				always: [
					{ guard: ({ context }) => !context.destination, target: 'invalidInput' },
					{ target: 'active' }
				]
			},
			active: {
				initial: 'waitingForSession',
				invoke: { src: 'session', onError: '#account-merge-destination.sessionFailed' },
				after: { 30000: '#account-merge-destination.timedOut' },
				on: {
					SESSION: [
						{
							guard: ({ context, event }) =>
								context.session !== undefined &&
								event.session.ready &&
								event.session.identityId === required(context.destination).identityId &&
								event.session.organizationId === required(context.destination).organizationId &&
								event.session.binding === dependencies.binding,
							actions: assign({ session: ({ event }) => event.session })
						},
						{
							target: '.checkingSession',
							actions: assign({ session: ({ event }) => event.session })
						}
					],
					SESSION_FAILED: '#account-merge-destination.sessionFailed',
					READ_FAILED: '#account-merge-destination.readFailed'
				},
				states: {
					waitingForSession: {},
					checkingSession: {
						always: [
							{
								guard: ({ context }) => !required(context.session).ready,
								target: '#account-merge-destination.sessionUnavailable'
							},
							{ target: 'checkingIdentity' }
						]
					},
					checkingIdentity: {
						always: [
							{
								guard: ({ context }) =>
									required(context.session).identityId !== required(context.destination).identityId,
								target: '#account-merge-destination.identityChanged'
							},
							{ target: 'checkingWorkspace' }
						]
					},
					checkingWorkspace: {
						always: [
							{
								guard: ({ context }) =>
									required(context.session).organizationId !==
									required(context.destination).organizationId,
								target: '#account-merge-destination.workspaceChanged'
							},
							{ target: 'checkingBinding' }
						]
					},
					checkingBinding: {
						always: [
							{
								guard: ({ context }) => required(context.session).binding !== dependencies.binding,
								target: '#account-merge-destination.bindingChanged'
							},
							{ target: 'authorizing' }
						]
					},
					authorizing: {
						initial: 'checking',
						invoke: [
							{
								src: 'organization',
								input: ({ context }) => required(context.destination),
								onError: '#account-merge-destination.readFailed'
							},
							{
								src: 'membership',
								input: ({ context }) => required(context.destination),
								onError: '#account-merge-destination.readFailed'
							}
						],
						on: {
							ORGANIZATIONS: {
								target: '.checking',
								actions: assign({ organizations: ({ event }) => event.rows })
							},
							MEMBERSHIPS: {
								target: '.checking',
								actions: assign({ memberships: ({ event }) => event.rows })
							}
						},
						states: {
							checking: {
								always: [
									{
										guard: ({ context }) =>
											context.organizations === undefined || context.memberships === undefined,
										target: 'waiting'
									},
									{ target: 'checkingScopes' }
								]
							},
							waiting: {},
							checkingScopes: {
								always: [
									{
										guard: ({ context }) =>
											required(context.organizations).some(
												(row) => row.id !== required(context.destination).organizationId
											) ||
											required(context.memberships).some(
												(row) =>
													row.organizationId !== required(context.destination).organizationId ||
													row.userId !== required(context.destination).identityId
											),
										target: '#account-merge-destination.invalidObservation'
									},
									{ target: 'checkingOwnership' }
								]
							},
							checkingOwnership: {
								always: [
									{
										guard: ({ context }) =>
											required(context.organizations).length !== 1 ||
											required(context.organizations)[0]?.kind !== 'personal' ||
											required(context.organizations)[0]?.ownerId !==
												required(context.destination).identityId,
										target: '#account-merge-destination.notOwned'
									},
									{ target: 'checkingMembership' }
								]
							},
							checkingMembership: {
								always: [
									{
										guard: ({ context }) =>
											required(context.memberships).length === 1 &&
											(required(context.memberships)[0]?.role === 'owner' ||
												required(context.memberships)[0]?.role === 'admin'),
										target: '#account-merge-destination.eligible'
									},
									{ target: '#account-merge-destination.membershipRequired' }
								]
							}
						}
					}
				}
			},
			eligible: finish((context) => ({
				outcome: 'eligible',
				destination: required(context.destination)
			})),
			invalidInput: failed('invalid-input'),
			sessionUnavailable: failed('session-unavailable'),
			identityChanged: failed('identity-changed'),
			workspaceChanged: failed('workspace-changed'),
			bindingChanged: failed('binding-changed'),
			invalidObservation: failed('invalid-observation'),
			notOwned: failed('not-owned-personal'),
			membershipRequired: failed('membership-required'),
			readFailed: failed('remote-read-failed'),
			sessionFailed: failed('session-observation-failed'),
			timedOut: failed('timeout'),
			cancelled: finish(() => ({ outcome: 'cancelled' })),
			closed: finish(() => ({ outcome: 'closed' }))
		}
	})
}
