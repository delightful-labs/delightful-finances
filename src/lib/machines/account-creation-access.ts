import { assign, setup, type SnapshotFrom } from 'xstate'
import type { FormCapability, FormChildEvent, FormObservation } from '#lib/form-contract.js'
import type {
	AccountCreationObservation,
	AccountCreationReason,
	AccountCreationScope
} from '#lib/account-creation-contract.js'
import { accountFormSchema } from '#lib/validation/accounts.js'
import type { Account } from '#lib/schema.js'
import { createSingleWriteFormOptions } from './scoped-form-policy.js'
import type { OrganizationMember } from '#lib/schema.js'

type Observation = {
	revision?: number
	organizationId: string | null
	userId: string | undefined
	sessionReady: boolean
	membership: OrganizationMember | null | undefined
	loading: boolean
	error: unknown
}

const access = setup<
	Observation,
	{ type: 'OBSERVE'; source: Observation },
	{},
	{},
	{},
	{},
	never,
	string,
	Observation | undefined
>({})

export const accountCreationAccessMachine = access.createMachine({
	id: 'account-creation-access',
	initial: 'checking',
	context: ({ input }) =>
		input ?? {
			organizationId: null,
			userId: undefined,
			sessionReady: false,
			membership: undefined,
			loading: true,
			error: null
		},
	on: {
		OBSERVE: {
			target: '.checking',
			actions: access.assign(({ event }) => event.source)
		}
	},
	states: {
		checking: {
			always: [
				{
					guard: ({ context }) =>
						!context.sessionReady || !context.organizationId || !context.userId,
					target: 'waiting'
				},
				{ guard: ({ context }) => context.error != null, target: 'error' },
				{ guard: ({ context }) => context.loading, target: 'waiting' },
				{
					guard: ({ context }) =>
						!context.membership ||
						context.membership.organizationId !== context.organizationId ||
						context.membership.userId !== context.userId,
					target: 'denied'
				},
				{
					guard: ({ context }) =>
						context.membership?.role === 'owner' || context.membership?.role === 'admin',
					target: 'allowed'
				},
				{ target: 'denied' }
			]
		},
		waiting: {},
		error: {},
		denied: {},
		allowed: { tags: 'can-create' }
	}
})

export function accountCreationScope(facts: AccountCreationObservation): AccountCreationScope {
	return {
		identityId: facts.identityId,
		organizationId: facts.organizationId,
		binding: facts.binding
	}
}
export function sameAccountCreationScope(left: AccountCreationScope, right: AccountCreationScope) {
	return (
		left.identityId === right.identityId &&
		left.organizationId === right.organizationId &&
		left.binding === right.binding
	)
}

/** Reuses the existing policy actor for display and pre-write authorization. */
export function createAccountCreationAvailability(binding: object) {
	type Context = {
		observation: FormObservation<AccountCreationObservation>
		capability: FormCapability<AccountCreationScope, AccountCreationReason>
	}
	const actors = { access: accountCreationAccessMachine }
	const machine = setup<
		Context,
		FormChildEvent<AccountCreationObservation>,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		FormObservation<AccountCreationObservation>
	>({ actors })
	const blocked = (reason: AccountCreationReason) =>
		machine.assign({
			capability: ({ context }) => ({
				revision: context.observation.revision,
				scope: accountCreationScope(context.observation.facts),
				readiness: { kind: 'blocked', reason }
			})
		})
	return machine.createMachine({
		id: 'account-creation-availability',
		initial: 'assessing',
		context: ({ input }) => ({
			observation: input,
			capability: {
				revision: -1,
				scope: accountCreationScope(input.facts),
				readiness: { kind: 'blocked', reason: 'loading' }
			}
		}),
		on: {
			OBSERVE: {
				target: '.assessing',
				actions: assign({ observation: ({ event }) => event.observation })
			}
		},
		states: {
			assessing: {
				always: [
					{
						guard: ({
							context: {
								observation: { facts }
							}
						}) => !facts.sessionReady || !facts.identityId || facts.binding !== binding,
						target: 'sessionUnavailable'
					},
					{
						guard: ({
							context: {
								observation: { facts }
							}
						}) => !facts.organizationId,
						target: 'selectWorkspace'
					},
					{
						guard: ({
							context: {
								observation: { facts }
							}
						}) => facts.error != null,
						target: 'loadFailed'
					},
					{
						guard: ({
							context: {
								observation: { facts }
							}
						}) => facts.loading,
						target: 'loading'
					},
					{ target: 'authorizing' }
				]
			},
			authorizing: {
				invoke: {
					id: 'access',
					src: 'access',
					input: ({
						context: {
							observation: { revision, facts }
						}
					}) => ({
						revision,
						organizationId: facts.organizationId,
						userId: facts.identityId ?? undefined,
						sessionReady: facts.sessionReady,
						membership: facts.membership,
						loading: facts.loading,
						error: facts.error
					}),
					onSnapshot: [
						{
							guard: ({ context, event }) =>
								event.snapshot.context.revision === context.observation.revision &&
								event.snapshot.hasTag('can-create'),
							target: 'ready'
						},
						{
							guard: ({ context, event }) =>
								event.snapshot.context.revision === context.observation.revision &&
								event.snapshot.matches('denied'),
							target: 'readOnly'
						},
						{
							guard: ({ context, event }) =>
								event.snapshot.context.revision === context.observation.revision &&
								event.snapshot.matches('error'),
							target: 'loadFailed'
						}
					],
					onError: 'loadFailed'
				}
			},
			sessionUnavailable: { entry: blocked('sessionUnavailable') },
			selectWorkspace: { entry: blocked('selectWorkspace') },
			loadFailed: { entry: blocked('loadFailed') },
			loading: { entry: blocked('loading') },
			readOnly: { entry: blocked('readOnly') },
			ready: {
				entry: assign({
					capability: ({ context }) => ({
						revision: context.observation.revision,
						scope: accountCreationScope(context.observation.facts),
						readiness: { kind: 'ready' }
					})
				})
			}
		}
	})
}
export function selectAccountCreationAvailability(
	snapshot: SnapshotFrom<ReturnType<typeof createAccountCreationAvailability>>
) {
	return snapshot.context.capability
}

type Values = { name: string; kind: 'cash' | 'bank' | 'card' }
export function createAccountCreationFormOptions(dependencies: {
	binding: object
	observe: () => AccountCreationObservation
	create: (organizationId: string, values: Values) => Promise<Account>
}) {
	const availability = createAccountCreationAvailability(dependencies.binding)
	return createSingleWriteFormOptions<
		Values,
		Account,
		AccountCreationReason,
		AccountCreationScope,
		AccountCreationObservation,
		SnapshotFrom<typeof availability>
	>({
		schema: accountFormSchema,
		mode: 'create',
		availability,
		selectAvailability: selectAccountCreationAvailability,
		scopeOf: accountCreationScope,
		sameScope: sameAccountCreationScope,
		observe: dependencies.observe,
		classifyBlocked: (reason) => (reason === 'readOnly' ? 'denied' : 'unavailable'),
		successContent: 'replace',
		write: async ({ request }) => {
			const id = request.scope.organizationId
			if (id === null) throw new Error('Missing authorized workspace')
			return dependencies.create(id, request.values)
		}
	})
}
