import {
	assign,
	fromPromise,
	or,
	setup,
	stateIn,
	type ErrorActorEvent,
	type OutputFrom
} from 'xstate'
import { app } from '#lib/schema.js'
import type { AccountWrite } from './account-write.js'
import type { Dependencies } from './types.js'
import { required } from './identity.js'

export type MappingInterruption = { type: 'CANCEL' } | { type: 'SHUTDOWN' }
type Settlement = 'notStarted' | 'rolledBack' | 'locallyPersisted' | 'unresolved'
export type MappingTransactionResult =
	| { outcome: 'succeeded' | 'unchanged' | 'cancelled' | 'closed'; settlement: Settlement }
	| { outcome: 'failed'; settlement: Settlement; error: unknown }
type Transaction = ReturnType<Dependencies['db']['beginTransaction']>
type Input = {
	db: Pick<Dependencies['db'], 'beginTransaction'>
	request: AccountWrite
	linkId: string
}
type Resource = { tx: Transaction; request: AccountWrite }

const open = fromPromise(({ input }: { input: Input['db'] }) =>
	Promise.resolve(input.beginTransaction())
)
const providerLinks = fromPromise(({ input }: { input: Resource }) =>
	input.tx.all(
		app.simplefinAccountLinks.where({
			organizationId: input.request.work.scope.organizationId,
			simplefinAccountId: input.request.provider.id
		})
	)
)
const destination = fromPromise(async ({ input }: { input: Resource }) => {
	const [links, accounts] = await Promise.all([
		input.tx.all(
			app.simplefinAccountLinks.where({
				organizationId: input.request.work.scope.organizationId,
				accountId: input.request.accountId
			})
		),
		input.tx.all(app.accounts.where({ id: input.request.accountId }))
	])
	return { links, account: accounts[0] }
})
type Creation = { tx: Transaction; request: Extract<AccountWrite, { kind: 'create' }> }
const createAccount = fromPromise(async ({ input }: { input: Creation }) => {
	input.tx.insert(app.accounts, input.request.values, { id: input.request.accountId })
})
type LinkValues = {
	organizationId: string
	connectionId: string
	simplefinAccountId: string
	accountId: string
	availableBalance?: string
	balanceDate?: Date
}
type LinkWrite = { tx: Transaction; id: string; values: LinkValues }
const insertLink = fromPromise(async ({ input }: { input: LinkWrite }) => {
	input.tx.insert(app.simplefinAccountLinks, input.values, { id: input.id })
})
const updateLink = fromPromise(async ({ input }: { input: LinkWrite }) => {
	input.tx.update(app.simplefinAccountLinks, input.id, input.values)
})
const commit = fromPromise(({ input }: { input: Transaction }) => Promise.resolve(input.commit()))
const settle = fromPromise(({ input }: { input: OutputFrom<typeof commit> }) =>
	input.wait({ tier: 'local' })
)
const rollback = fromPromise(({ input }: { input: Transaction }) => input.rollback())

type Context = {
	input: Input
	tx: Transaction | undefined
	links: OutputFrom<typeof providerLinks>
	destination: OutputFrom<typeof destination> | undefined
	write: OutputFrom<typeof commit> | undefined
	error: unknown
	settlement: Settlement
	result: MappingTransactionResult | undefined
}
function resource(context: Context): Resource {
	return { tx: required(context.tx), request: context.input.request }
}
function linkWrite(context: Context, id: string): LinkWrite {
	const { work, provider, accountId } = context.input.request
	return {
		tx: required(context.tx),
		id,
		values: {
			organizationId: work.scope.organizationId,
			connectionId: work.current.id,
			simplefinAccountId: provider.id,
			accountId,
			...(provider.availableBalance !== undefined && provider.balanceDate !== undefined
				? {
						availableBalance: provider.availableBalance,
						balanceDate: provider.balanceDate
					}
				: {})
		}
	}
}

/** Owns one transaction; interruption never discards an acquired resource or issued commit. */
const actors = {
	open,
	providerLinks,
	destination,
	createAccount,
	insertLink,
	updateLink,
	commit,
	settle,
	rollback
}
const workflow = setup<
	Context,
	MappingInterruption | ErrorActorEvent,
	typeof actors,
	{},
	{},
	{ interrupted: undefined; cancelling: undefined; closing: undefined },
	never,
	string,
	Input,
	MappingTransactionResult
>({
	actors,
	guards: {
		interrupted: or(['cancelling', 'closing']),
		cancelling: stateIn({ running: { control: 'cancelling' } }),
		closing: stateIn({ running: { control: 'closing' } })
	}
})
const failed = workflow.assign(({ event }) => ({
	error: 'error' in event ? (event.error ?? new Error('save_failure')) : new Error('save_failure')
}))

export const accountWriteTransaction = workflow.createMachine({
	id: 'bank-account-write-transaction',
	context: ({ input }) => ({
		input,
		tx: undefined,
		links: [],
		destination: undefined,
		write: undefined,
		error: undefined,
		settlement: 'notStarted',
		result: undefined
	}),
	initial: 'running',
	output: ({ context }) => required(context.result),
	states: {
		running: {
			type: 'parallel',
			states: {
				control: {
					initial: 'active',
					states: {
						active: { on: { CANCEL: 'cancelling', SHUTDOWN: 'closing' } },
						cancelling: { on: { CANCEL: {}, SHUTDOWN: 'closing' } },
						closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
					}
				},
				work: {
					initial: 'opening',
					states: {
						opening: {
							invoke: {
								src: 'open',
								input: ({ context }) => context.input.db,
								onDone: {
									target: 'checkingAfterOpen',
									actions: assign({ tx: ({ event }) => event.output })
								},
								onError: { target: 'finishing', actions: failed }
							}
						},
						checkingAfterOpen: {
							always: [
								{ guard: 'interrupted', target: 'rollingBack' },
								{ target: 'loadingProviderLinks' }
							]
						},
						loadingProviderLinks: {
							invoke: {
								src: 'providerLinks',
								input: ({ context }) => resource(context),
								onDone: {
									target: 'checkingProviderLinks',
									actions: assign({ links: ({ event }) => event.output })
								},
								onError: { target: 'rollingBack', actions: failed }
							}
						},
						checkingProviderLinks: {
							always: [
								{ guard: 'interrupted', target: 'rollingBack' },
								{ guard: ({ context }) => context.links.length > 1, target: 'invalidMapping' },
								{
									guard: ({ context }) =>
										context.input.request.kind === 'create' && context.links.length === 1,
									target: 'rollingBack'
								},
								{ target: 'loadingDestination' }
							]
						},
						loadingDestination: {
							invoke: {
								src: 'destination',
								input: ({ context }) => resource(context),
								onDone: {
									target: 'checkingDestination',
									actions: assign({ destination: ({ event }) => event.output })
								},
								onError: { target: 'rollingBack', actions: failed }
							}
						},
						checkingDestination: {
							always: [
								{ guard: 'interrupted', target: 'rollingBack' },
								{
									guard: ({ context }) =>
										required(context.destination).links.some(
											(link) => link.simplefinAccountId !== context.input.request.provider.id
										),
									target: 'accountConflict'
								},
								{ target: 'checkingAccount' }
							]
						},
						checkingAccount: {
							always: [
								{
									guard: ({ context }) => {
										const account = required(context.destination).account
										const request = context.input.request
										return (
											account !== undefined &&
											(account.organizationId !== request.work.scope.organizationId ||
												Boolean(account.archivedAt) ||
												(request.kind === 'create' &&
													account.currency !== request.provider.currency))
										)
									},
									target: 'invalidMapping'
								},
								{
									guard: ({ context }) =>
										context.input.request.kind === 'map' && !required(context.destination).account,
									target: 'invalidMapping'
								},
								{ target: 'choosingAccountWrite' }
							]
						},
						choosingAccountWrite: {
							always: [
								{
									guard: ({ context }) =>
										context.input.request.kind === 'create' &&
										!required(context.destination).account,
									target: 'creatingAccount'
								},
								{ target: 'choosingLinkWrite' }
							]
						},
						creatingAccount: {
							invoke: {
								src: 'createAccount',
								input: ({ context }) => {
									const request = context.input.request
									if (request.kind !== 'create') throw new Error('invalid-machine-context')
									return { tx: required(context.tx), request }
								},
								onDone: 'choosingLinkWrite',
								onError: { target: 'rollingBack', actions: failed }
							}
						},
						choosingLinkWrite: {
							always: [
								{ guard: 'interrupted', target: 'rollingBack' },
								{ guard: ({ context }) => context.links.length === 1, target: 'updatingLink' },
								{ target: 'insertingLink' }
							]
						},
						updatingLink: {
							invoke: {
								src: 'updateLink',
								input: ({ context }) => linkWrite(context, required(context.links[0]).id),
								onDone: 'checkingBeforeCommit',
								onError: { target: 'rollingBack', actions: failed }
							}
						},
						insertingLink: {
							invoke: {
								src: 'insertLink',
								input: ({ context }) => linkWrite(context, context.input.linkId),
								onDone: 'checkingBeforeCommit',
								onError: { target: 'rollingBack', actions: failed }
							}
						},
						checkingBeforeCommit: {
							always: [{ guard: 'interrupted', target: 'rollingBack' }, { target: 'committing' }]
						},
						committing: {
							entry: assign({ settlement: 'unresolved' }),
							invoke: {
								src: 'commit',
								input: ({ context }) => required(context.tx),
								onDone: {
									target: 'settling',
									actions: assign({ write: ({ event }) => event.output })
								},
								onError: { target: 'rollingBack', actions: failed }
							}
						},
						settling: {
							invoke: {
								src: 'settle',
								input: ({ context }) => required(context.write),
								onDone: {
									target: 'finishing',
									actions: assign({ settlement: 'locallyPersisted' })
								},
								onError: { target: 'rollingBack', actions: failed }
							}
						},
						invalidMapping: {
							entry: assign({ error: () => new Error('mapping') }),
							always: 'rollingBack'
						},
						accountConflict: {
							entry: assign({ error: () => new Error('account_already_linked') }),
							always: 'rollingBack'
						},
						rollingBack: {
							invoke: {
								src: 'rollback',
								input: ({ context }) => required(context.tx),
								onDone: [
									{
										guard: ({ event }) => event.output,
										target: 'finishing',
										actions: assign({ settlement: 'rolledBack' })
									},
									{
										target: 'finishing',
										actions: assign({
											settlement: 'unresolved',
											error: ({ context }) => context.error ?? new Error('save_failure')
										})
									}
								],
								onError: {
									target: 'finishing',
									actions: assign({
										settlement: 'unresolved',
										error: ({ context }) => context.error ?? new Error('save_failure')
									})
								}
							}
						},
						finishing: {
							always: [
								{ guard: 'closing', target: '#bank-account-write-transaction.closed' },
								{ guard: 'cancelling', target: '#bank-account-write-transaction.cancelled' },
								{
									guard: ({ context }) => context.error !== undefined,
									target: '#bank-account-write-transaction.failed'
								},
								{
									guard: ({ context }) => context.settlement === 'locallyPersisted',
									target: '#bank-account-write-transaction.succeeded'
								},
								{ target: '#bank-account-write-transaction.unchanged' }
							]
						}
					}
				}
			}
		},
		succeeded: {
			type: 'final',
			entry: assign({
				result: ({ context }): MappingTransactionResult => ({
					outcome: 'succeeded',
					settlement: context.settlement
				})
			})
		},
		unchanged: {
			type: 'final',
			entry: assign({
				result: ({ context }): MappingTransactionResult => ({
					outcome: 'unchanged',
					settlement: context.settlement
				})
			})
		},
		cancelled: {
			type: 'final',
			entry: assign({
				result: ({ context }): MappingTransactionResult => ({
					outcome: 'cancelled',
					settlement: context.settlement
				})
			})
		},
		closed: {
			type: 'final',
			entry: assign({
				result: ({ context }): MappingTransactionResult => ({
					outcome: 'closed',
					settlement: context.settlement
				})
			})
		},
		failed: {
			type: 'final',
			entry: assign({
				result: ({ context }): MappingTransactionResult => ({
					outcome: 'failed',
					settlement: context.settlement,
					error: context.error
				})
			})
		}
	}
})
