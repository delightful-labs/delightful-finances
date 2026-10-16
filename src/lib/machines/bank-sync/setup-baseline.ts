import { assign, fromPromise, setup } from 'xstate'
import { app } from '#lib/schema.js'
import type { CredentialScope } from '#lib/validation/integrations.js'
import type { Connection, Dependencies } from './types.js'

export type SetupBaseline = {
	scope: CredentialScope
	baselineCiphertext: string | null
	baselineStatus: Connection['status'] | null
}
type Context = SetupBaseline & { current: Connection | undefined; error: unknown }

export function createSetupBaselineMachine({ db }: Dependencies) {
	const actors = {
		connection: fromPromise(({ input }: { input: SetupBaseline }) =>
			db.all(app.simplefinConnections.where({ id: input.scope.connectionId }))
		)
	}
	return setup<
		Context,
		{ type: 'CHECK' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		SetupBaseline,
		{ error: unknown }
	>({ actors }).createMachine({
		id: 'bank-setup-baseline',
		context: ({ input }) => ({ ...input, current: undefined, error: undefined }),
		initial: 'loadingConnection',
		output: ({ context }) => ({ error: context.error }),
		states: {
			loadingConnection: {
				invoke: {
					src: 'connection',
					input: ({ context }) => context,
					onDone: {
						target: 'checkingCiphertext',
						actions: assign({ current: ({ event }) => event.output[0] })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			checkingCiphertext: {
				always: [
					{
						guard: ({ context }) =>
							(context.current?.ciphertext ?? null) !== context.baselineCiphertext,
						target: 'changed'
					},
					{ target: 'checkingStatus' }
				]
			},
			checkingStatus: {
				always: [
					{
						guard: ({ context }) => (context.current?.status ?? null) !== context.baselineStatus,
						target: 'changed'
					},
					{ target: 'unchanged' }
				]
			},
			unchanged: { type: 'final' },
			changed: { type: 'final', entry: assign({ error: () => new Error('disconnected') }) },
			failed: { type: 'final' }
		}
	})
}
