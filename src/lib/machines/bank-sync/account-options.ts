import { assign, setup } from 'xstate'
import type { Account } from '#lib/schema.js'
import type { ProviderSummary } from './types.js'
import { required } from './identity.js'

type Input = {
	provider: ProviderSummary
	accounts: readonly Account[]
	mappings: ReadonlyMap<string, string>
}
type Mapping = { kind: 'linked'; account: Account } | { kind: 'broken' } | { kind: 'unmapped' }
type Context = Input & {
	selectedAccountId: string
	mapping: Mapping | undefined
	index: number
	eligibleAccounts: Account[]
}
export type { ProviderAccountView } from '#lib/contracts/bank-presentation-contract.js'

export const accountOptionsMachine = setup<
	Context,
	{ type: 'CHECK' },
	{},
	{},
	{},
	{},
	never,
	string,
	Input
>({}).createMachine({
	id: 'bank-account-options',
	type: 'parallel',
	context: ({ input }) => ({
		...input,
		selectedAccountId: input.mappings.get(input.provider.id) ?? '',
		mapping: undefined,
		index: 0,
		eligibleAccounts: []
	}),
	states: {
		mapping: {
			initial: 'checkingLink',
			states: {
				checkingLink: {
					always: [
						{
							guard: ({ context }) => !context.mappings.has(context.provider.id),
							target: 'unmapped'
						},
						{ target: 'checkingAccount' }
					]
				},
				checkingAccount: {
					always: [
						{
							guard: ({ context }) =>
								context.accounts.some((account) => account.id === context.selectedAccountId),
							target: 'linked'
						},
						{ target: 'broken' }
					]
				},
				linked: {
					entry: assign({
						mapping: ({ context }) => ({
							kind: 'linked',
							account: required(
								context.accounts.find((account) => account.id === context.selectedAccountId)
							)
						})
					})
				},
				broken: { entry: assign({ mapping: { kind: 'broken' } }) },
				unmapped: { entry: assign({ mapping: { kind: 'unmapped' } }) }
			}
		},
		destinations: {
			initial: 'nextAccount',
			states: {
				nextAccount: {
					always: [
						{
							guard: ({ context }) => context.index >= context.accounts.length,
							target: 'checkingAlternatives'
						},
						{ target: 'checkingAssignment' }
					]
				},
				checkingAssignment: {
					always: [
						{
							guard: ({ context }) =>
								Array.from(context.mappings).some(
									([providerId, accountId]) =>
										providerId !== context.provider.id &&
										accountId === required(context.accounts[context.index]).id
								),
							target: 'advanceAccount'
						},
						{ target: 'eligibleAccount' }
					]
				},
				eligibleAccount: {
					entry: assign({
						eligibleAccounts: ({ context }) => [
							...context.eligibleAccounts,
							required(context.accounts[context.index])
						]
					}),
					always: 'advanceAccount'
				},
				advanceAccount: {
					entry: assign({ index: ({ context }) => context.index + 1 }),
					always: 'nextAccount'
				},
				checkingAlternatives: {
					always: [
						{
							guard: ({ context }) =>
								context.eligibleAccounts.some(
									(account) => account.id !== context.selectedAccountId
								),
							target: 'available'
						},
						{ target: 'unavailable' }
					]
				},
				available: { tags: 'show-existing' },
				unavailable: {}
			}
		}
	}
})
