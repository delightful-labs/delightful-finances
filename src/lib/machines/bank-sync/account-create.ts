import { assign, fromPromise, setup } from 'xstate'
import { stableUuid } from '#lib/data.js'
import { appAccountSchema } from '#lib/validation/accounts.js'
import { createAccountWriteMachine } from './account-write.js'
import { required } from './identity.js'
import type { Dependencies, OperationWork, ProviderSummary, Result } from './types.js'

type Input = { work: OperationWork; provider: ProviderSummary }
type Context = Input & {
	values: ReturnType<typeof appAccountSchema.parse> | undefined
	accountId: string | undefined
	error: unknown
}

export function createAccountCreationMachine(dependencies: Dependencies) {
	const actors = {
		validate: fromPromise(({ input }: { input: Input }) =>
			Promise.resolve(
				appAccountSchema.parse({
					organizationId: input.work.scope.organizationId,
					name: input.provider.name,
					kind: 'bank',
					currency: input.provider.currency
				})
			)
		),
		accountId: fromPromise(({ input }: { input: Input }) =>
			stableUuid(input.work.scope.organizationId, `simplefin-account:${input.provider.id}`)
		),
		write: createAccountWriteMachine(dependencies)
	}
	return setup<
		Context,
		{ type: 'CREATE' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		Result<undefined>
	>({ actors }).createMachine({
		id: 'bank-account-create',
		context: ({ input }) => ({
			...input,
			values: undefined,
			accountId: undefined,
			error: undefined
		}),
		initial: 'validatingAccount',
		output: ({ context }) =>
			context.error === undefined
				? { ok: true, value: undefined }
				: { ok: false, error: context.error },
		states: {
			validatingAccount: {
				invoke: {
					src: 'validate',
					input: ({ context }) => context,
					onDone: {
						target: 'generatingAccountId',
						actions: assign({ values: ({ event }) => event.output })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			generatingAccountId: {
				invoke: {
					src: 'accountId',
					input: ({ context }) => context,
					onDone: {
						target: 'writingAccountAndLink',
						actions: assign({ accountId: ({ event }) => event.output })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			writingAccountAndLink: {
				invoke: {
					src: 'write',
					input: ({ context }) => ({
						kind: 'create',
						work: context.work,
						provider: context.provider,
						accountId: required(context.accountId),
						values: required(context.values)
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
			failed: { type: 'final' }
		}
	})
}
