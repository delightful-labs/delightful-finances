import { assign, setup } from 'xstate'
import { createAccountCreationMachine } from './account-create.js'
import { createAccountWriteMachine } from './account-write.js'
import { createAccountUnlinkMachine } from './account-unlink.js'
import { required } from './identity.js'
import type { Dependencies, OperationWork, ProviderSummary, Result } from './types.js'

type Input = { work: OperationWork; discovered: ProviderSummary[] }
type Context = Input & { provider: ProviderSummary | undefined; error: unknown }

export function createAccountMappingMachine(dependencies: Dependencies) {
	const actors = {
		createAccount: createAccountCreationMachine(dependencies),
		mapAccount: createAccountWriteMachine(dependencies),
		unlinkAccount: createAccountUnlinkMachine(dependencies)
	}
	return setup<
		Context,
		{ type: 'MAP' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		Result<undefined>
	>({ actors }).createMachine({
		id: 'bank-account-mapping',
		context: ({ input }) => ({ ...input, provider: undefined, error: undefined }),
		initial: 'checkingCommand',
		output: ({ context }) =>
			context.error === undefined
				? { ok: true, value: undefined }
				: { ok: false, error: context.error },
		states: {
			checkingCommand: {
				always: [
					{
						guard: ({ context }) => context.work.command.type === 'CREATE_ACCOUNT',
						target: 'selectingProvider'
					},
					{
						guard: ({ context }) => context.work.command.type === 'MAP',
						target: 'selectingProvider'
					},
					{ target: 'invalidMapping' }
				]
			},
			selectingProvider: {
				entry: assign({
					provider: ({ context }) => {
						const command = context.work.command
						return 'providerId' in command
							? context.discovered.find((row) => row.id === command.providerId)
							: undefined
					}
				}),
				always: [
					{ guard: ({ context }) => !context.provider, target: 'invalidMapping' },
					{
						guard: ({ context }) => context.work.command.type === 'CREATE_ACCOUNT',
						target: 'creating'
					},
					{ target: 'choosingMapping' }
				]
			},
			choosingMapping: {
				always: [
					{
						guard: ({ context }) =>
							context.work.command.type === 'MAP' && !context.work.command.accountId,
						target: 'unlinking'
					},
					{ target: 'mapping' }
				]
			},
			creating: {
				invoke: {
					src: 'createAccount',
					input: ({ context }) => ({ work: context.work, provider: required(context.provider) }),
					onDone: [
						{
							guard: ({ event }) => !event.output.ok,
							target: 'failed',
							actions: assign({
								error: ({ event }) => (event.output.ok ? undefined : event.output.error)
							})
						},
						{ target: 'complete' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			mapping: {
				invoke: {
					src: 'mapAccount',
					input: ({ context }) => ({
						kind: 'map',
						work: context.work,
						provider: required(context.provider),
						accountId: required(
							context.work.command.type === 'MAP' ? context.work.command.accountId : undefined
						)
					}),
					onDone: [
						{
							guard: ({ event }) => !event.output.ok,
							target: 'failed',
							actions: assign({
								error: ({ event }) => (event.output.ok ? undefined : event.output.error)
							})
						},
						{ target: 'complete' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			unlinking: {
				invoke: {
					src: 'unlinkAccount',
					input: ({ context }) => ({
						work: context.work,
						providerId: required(context.provider).id
					}),
					onDone: [
						{
							guard: ({ event }) => !event.output.ok,
							target: 'failed',
							actions: assign({
								error: ({ event }) => (event.output.ok ? undefined : event.output.error)
							})
						},
						{ target: 'complete' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			complete: { type: 'final' },
			invalidMapping: { type: 'final', entry: assign({ error: () => new Error('mapping') }) },
			failed: { type: 'final' }
		}
	})
}
