import { assign, fromPromise, setup, type SnapshotFrom } from 'xstate'
import type { RecoveryIdentity, RecoveryPhraseView } from '#lib/recovery-phrase-contract.js'
type Event =
	| { type: 'REVEAL' | 'HIDE' | 'SHUTDOWN' }
	| { type: 'OBSERVE'; identity: RecoveryIdentity }
	| { type: 'CONFIRM'; value: boolean }
/** Resource-free phrase conversion: cancellation discards late output and clears retained data. */
export function createRecoveryPhraseMachine(
	reveal: (identity: RecoveryIdentity) => Promise<string>
) {
	const actors = { reveal: fromPromise<string, RecoveryIdentity>(({ input }) => reveal(input)) }
	const model = setup<
		{ identity: RecoveryIdentity; phrase: string | undefined },
		Event,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		RecoveryIdentity
	>({ actors })
	const clear = model.assign({ phrase: undefined })
	return model.createMachine({
		id: 'recovery-phrase',
		initial: 'hidden',
		context: ({ input }) => ({ identity: input, phrase: undefined }),
		on: {
			SHUTDOWN: '.closed',
			HIDE: { target: '.hidden', actions: clear },
			OBSERVE: [
				{
					guard: ({ context, event }) =>
						context.identity.identityId !== event.identity.identityId ||
						context.identity.binding !== event.identity.binding,
					target: '.hidden',
					actions: [assign({ identity: ({ event }) => event.identity }), clear]
				}
			]
		},
		states: {
			hidden: {
				on: {
					REVEAL: [
						{
							guard: ({ context }) =>
								context.identity.identityId !== null && context.identity.binding !== null,
							target: 'revealing'
						},
						{ target: 'failed' }
					]
				}
			},
			revealing: {
				invoke: {
					src: 'reveal',
					input: ({ context }) => context.identity,
					onDone: { target: 'revealed', actions: assign({ phrase: ({ event }) => event.output }) },
					onError: 'failed'
				}
			},
			revealed: {
				initial: 'unconfirmed',
				states: {
					unconfirmed: {
						on: { CONFIRM: { guard: ({ event }) => event.value, target: 'confirmed' } }
					},
					confirmed: {
						on: { CONFIRM: { guard: ({ event }) => !event.value, target: 'unconfirmed' } }
					}
				}
			},
			failed: { entry: clear, on: { REVEAL: 'revealing' } },
			closed: {
				type: 'final',
				entry: [clear, assign({ identity: () => ({ identityId: null, binding: null }) })]
			}
		}
	})
}
export function selectRecoveryPhraseView(
	s: SnapshotFrom<ReturnType<typeof createRecoveryPhraseMachine>>
): RecoveryPhraseView {
	if (s.matches('revealed')) {
		if (s.context.phrase === undefined) throw new Error('Missing revealed phrase')
		return {
			kind: 'revealed',
			phrase: s.context.phrase,
			confirmation: s.matches({ revealed: 'confirmed' }) ? 'confirmed' : 'unconfirmed'
		}
	}
	if (s.matches('revealing')) return { kind: 'revealing' }
	if (s.matches('failed')) return { kind: 'failed' }
	return { kind: s.matches('closed') ? 'closed' : 'hidden' }
}
