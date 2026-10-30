import { assign, fromPromise, raise, sendParent, setup, stateIn } from 'xstate'
import type { JazzClient, JazzSession } from 'jazz-tools/svelte'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import { required } from '../bank-sync/identity.js'

type Session = JazzSession<JazzClient>
export type RecoveryNavigation = { origin: string; destination: string; identity: string }
export type RecoveryRequest =
	| { kind: 'restore'; phrase: string; origin: string; destination: string }
	| ({ kind: 'navigate' } & RecoveryNavigation)
export type RecoveryResult =
	| {
			outcome: 'invalid' | 'restoreFailed' | 'restored' | 'closed'
			mutation: 'notStarted' | 'settled'
	  }
	| {
			outcome: 'navigationFailed'
			mutation: 'notStarted' | 'settled'
			navigation: RecoveryNavigation | undefined
	  }
export type RecoveryNotice =
	| { type: 'RECOVERY_VALIDATED'; attempt: number }
	| { type: 'RECOVERY_DRAIN_REQUESTED'; attempt: number }
type Input = {
	attempt: number
	request: RecoveryRequest
	session: Session
	readHref: () => string
	navigate: (destination: string) => Promise<void>
}
type Context = {
	attempt: number
	request: RecoveryRequest | undefined
	session: Session
	readHref: () => string
	navigate: Input['navigate']
	origin: string
	destination: string
	secret: string | undefined
	identity: string | undefined
	mutation: 'notStarted' | 'settled'
	result: RecoveryResult | undefined
}
type Event = { type: 'WORKSPACE_DRAINED' } | { type: 'SHUTDOWN' } | { type: 'RELEASE_SECRET' }

const actors = {
	parse: fromPromise(async ({ input }: { input: string }) => RecoveryPhrase.toSecret(input)),
	restore: fromPromise(({ input }: { input: { session: Session; secret: string } }) =>
		input.session.restoreLocalFirst(input.secret)
	),
	identity: fromPromise(async ({ input }: { input: Session }) => input.getSnapshot().account?.id),
	navigationFacts: fromPromise(
		async ({ input }: { input: { session: Session; readHref: () => string } }) => {
			const snapshot = input.session.getSnapshot()
			return { status: snapshot.status, identity: snapshot.account?.id, href: input.readHref() }
		}
	),
	navigate: fromPromise(
		({ input }: { input: { navigate: Input['navigate']; destination: string } }) =>
			input.navigate(input.destination)
	)
}
const model = setup<
	Context,
	Event,
	typeof actors,
	{},
	{ settled: undefined; navigationFailed: undefined },
	{ closingRestore: undefined; closingNavigation: undefined },
	never,
	string,
	Input,
	RecoveryResult
>({
	actors,
	guards: {
		closingRestore: stateIn({ restoring: 'closing' }),
		closingNavigation: stateIn({ navigating: 'closing' })
	},
	actions: {
		settled: assign({ mutation: (): Context['mutation'] => 'settled', secret: undefined }),
		navigationFailed: assign({
			result: ({ context }): RecoveryResult => ({
				outcome: 'navigationFailed',
				mutation: context.mutation,
				navigation: context.identity
					? { identity: context.identity, origin: context.origin, destination: context.destination }
					: undefined
			})
		})
	}
})
const finish = (outcome: 'invalid' | 'restoreFailed' | 'restored' | 'closed') =>
	model.createStateConfig({
		type: 'final',
		entry: assign({
			result: ({ context }): RecoveryResult => ({ outcome, mutation: context.mutation }),
			request: undefined,
			secret: undefined
		})
	})

/** Owns one recovery attempt after its page is gone; the application owns workspace draining. */
export const sessionRecoveryMachine = model.createMachine({
	id: 'session-recovery',
	initial: 'choosing',
	context: ({ input }) => ({
		attempt: input.attempt,
		request: input.request,
		session: input.session,
		readHref: input.readHref,
		navigate: input.navigate,
		origin: input.request.origin,
		destination: input.request.destination,
		secret: undefined,
		identity: input.request.kind === 'navigate' ? input.request.identity : undefined,
		mutation: 'notStarted',
		result: undefined
	}),
	output: ({ context }) => required(context.result),
	on: { SHUTDOWN: '.closed' },
	states: {
		choosing: {
			always: [
				{
					guard: ({ context }) => context.request?.kind === 'navigate',
					target: 'checkingNavigation',
					actions: assign({ request: undefined })
				},
				{ target: 'validating' }
			]
		},
		validating: {
			invoke: {
				src: 'parse',
				input: ({ context }) => {
					const request = required(context.request)
					if (request.kind !== 'restore') throw new Error('Missing recovery input')
					return request.phrase
				},
				onDone: {
					target: 'draining',
					actions: [
						assign({ secret: ({ event }) => event.output, request: undefined }),
						sendParent(({ context }): RecoveryNotice => ({
							type: 'RECOVERY_VALIDATED',
							attempt: context.attempt
						}))
					]
				},
				onError: 'invalid'
			}
		},
		draining: {
			entry: sendParent(({ context }): RecoveryNotice => ({
				type: 'RECOVERY_DRAIN_REQUESTED',
				attempt: context.attempt
			})),
			on: { WORKSPACE_DRAINED: 'restoring' }
		},
		restoring: {
			// Invocation input is bound in this entry microstep before the raised event clears our copy.
			entry: raise({ type: 'RELEASE_SECRET' }),
			initial: 'active',
			invoke: {
				src: 'restore',
				input: ({ context }) => ({ session: context.session, secret: required(context.secret) }),
				onDone: [
					{ guard: 'closingRestore', target: 'closed', actions: 'settled' },
					{ target: 'readingIdentity', actions: 'settled' }
				],
				onError: [
					{ guard: 'closingRestore', target: 'closed', actions: 'settled' },
					{ target: 'restoreFailed', actions: 'settled' }
				]
			},
			on: { SHUTDOWN: '.closing', RELEASE_SECRET: { actions: assign({ secret: undefined }) } },
			states: { active: {}, closing: { on: { SHUTDOWN: {} } } }
		},
		readingIdentity: {
			invoke: {
				src: 'identity',
				input: ({ context }) => context.session,
				onDone: [
					{
						guard: ({ event }) => event.output !== undefined,
						target: 'checkingNavigation',
						actions: assign({ identity: ({ event }) => event.output })
					},
					{ target: 'navigationFailed', actions: 'navigationFailed' }
				],
				onError: { target: 'navigationFailed', actions: 'navigationFailed' }
			}
		},
		checkingNavigation: {
			invoke: {
				src: 'navigationFacts',
				input: ({ context }) => ({ session: context.session, readHref: context.readHref }),
				onDone: [
					{
						guard: ({ context, event }) =>
							event.output.status === 'ready' &&
							event.output.identity === context.identity &&
							event.output.href === context.origin,
						target: 'navigating'
					},
					{ target: 'restored' }
				],
				onError: { target: 'navigationFailed', actions: 'navigationFailed' }
			}
		},
		navigating: {
			initial: 'active',
			invoke: {
				src: 'navigate',
				input: ({ context }) => ({ navigate: context.navigate, destination: context.destination }),
				onDone: [{ guard: 'closingNavigation', target: 'closed' }, { target: 'restored' }],
				onError: [
					{ guard: 'closingNavigation', target: 'closed' },
					{ target: 'navigationFailed', actions: 'navigationFailed' }
				]
			},
			on: { SHUTDOWN: '.closing' },
			states: { active: {}, closing: { on: { SHUTDOWN: {} } } }
		},
		invalid: finish('invalid'),
		restoreFailed: finish('restoreFailed'),
		restored: finish('restored'),
		closed: finish('closed'),
		navigationFailed: { type: 'final', entry: assign({ request: undefined, secret: undefined }) }
	}
})
