import { setup } from 'xstate'
import type { OrganizationMember } from '#lib/schema.js'

type Observation = {
	organizationId: string | null
	userId: string | undefined
	sessionReady: boolean
	membership: OrganizationMember | null | undefined
	loading: boolean
	error: unknown
}

const access = setup<Observation, { type: 'OBSERVE'; source: Observation }>({})

export const accountCreationAccessMachine = access.createMachine({
	id: 'account-creation-access',
	initial: 'checking',
	context: {
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
