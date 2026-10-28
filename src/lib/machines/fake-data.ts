import { assign, fromPromise, not, or, setup, stateIn, type OutputFrom } from 'xstate'
import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '../schema.js'
import type { FakeDataPlan } from '../domain/fake-data.js'
import { createJazzTransactionActors } from './jazz-transaction-actors.js'

export type FakeDataDb = Pick<ReturnType<typeof getDb>, 'all' | 'beginExclusiveTransaction'>
type Transaction = ReturnType<FakeDataDb['beginExclusiveTransaction']>
type Input = { db: FakeDataDb; organizationId: string; userId: string }
type Event = { type: 'CANCEL' } | { type: 'SHUTDOWN' }
type Settlement = 'notStarted' | 'confirmed' | 'unresolved'
export type FakeDataResult =
	| { outcome: 'seeded'; settlement: 'confirmed'; accountCount: number; transactionCount: number }
	| { outcome: 'skipped'; settlement: 'notStarted' }
	| { outcome: 'failed'; settlement: 'notStarted' | 'unresolved'; error: unknown }
	| { outcome: 'cancelled' | 'closed'; settlement: Settlement }

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing fake-data resource')
	return value
}
const transactionActors = createJazzTransactionActors(
	(db: FakeDataDb) => db.beginExclusiveTransaction(),
	(write: ReturnType<Transaction['commit']>) => write.wait()
)
const readLocal = fromPromise(async ({ input }: { input: Input }) => {
	const [accounts, transactions] = await Promise.all([
		input.db.all(app.accounts.limit(1), { tier: ReadTier.LocalFirst }),
		input.db.all(app.transactions.limit(1), { tier: ReadTier.LocalFirst })
	])
	return accounts.length > 0 || transactions.length > 0
})
const readAuthority = fromPromise(async ({ input }: { input: Input }) => {
	const [accounts, transactions, organizations, categories] = await Promise.all([
		input.db.all(app.accounts.limit(1), { tier: ReadTier.Remote }),
		input.db.all(app.transactions.limit(1), { tier: ReadTier.Remote }),
		input.db.all(app.organizations.where({ id: input.organizationId }), { tier: ReadTier.Remote }),
		input.db.all(
			app.categories.where({ organizationId: input.organizationId, archivedAt: { isNull: true } }),
			{ tier: ReadTier.Remote }
		)
	])
	return {
		hasData: accounts.length > 0 || transactions.length > 0,
		organization: organizations[0],
		categories
	}
})
const prepare = fromPromise(
	async ({ input }: { input: { scope: Input; records: OutputFrom<typeof readAuthority> } }) => {
		const { prepareFakeData } = await import('../domain/fake-data.js')
		return prepareFakeData(input.scope.organizationId, input.records.categories)
	}
)
const recheck = fromPromise(async ({ input }: { input: { tx: Transaction; scope: Input } }) => {
	const [accounts, transactions, organizations, categories] = await Promise.all([
		input.tx.all(app.accounts.limit(1)),
		input.tx.all(app.transactions.limit(1)),
		input.tx.all(app.organizations.where({ id: input.scope.organizationId })),
		input.tx.all(
			app.categories.where({
				organizationId: input.scope.organizationId,
				archivedAt: { isNull: true }
			})
		)
	])
	return {
		hasData: accounts.length > 0 || transactions.length > 0,
		organization: organizations[0],
		categories
	}
})
const stage = fromPromise(({ input }: { input: { tx: Transaction; plan: FakeDataPlan } }) => {
	for (const account of input.plan.accounts)
		input.tx.insert(app.accounts, account.values, { id: account.id })
	for (const transaction of input.plan.transactions)
		input.tx.insert(app.transactions, transaction.values, { id: transaction.id })
	return Promise.resolve()
})
const actors = { ...transactionActors, readLocal, readAuthority, prepare, recheck, stage }
type Context = Input & {
	tx: Transaction | undefined
	records: OutputFrom<typeof readAuthority> | undefined
	plan: FakeDataPlan | undefined
	write: OutputFrom<typeof transactionActors.commit> | undefined
	result: FakeDataResult | undefined
}

/** Seed only authoritative emptiness; own the exclusive transaction until confirmed or rolled back. */
export const fakeDataSetup = setup<
	Context,
	Event,
	typeof actors,
	{},
	{},
	{
		closing: undefined
		cancelling: undefined
		interrupted: undefined
		hasData: undefined
		owned: undefined
		categoriesReady: undefined
		planStillValid: undefined
	},
	never,
	string,
	Input,
	FakeDataResult
>({
	actors,
	guards: {
		closing: stateIn({ running: { control: 'closing' } }),
		cancelling: stateIn({ running: { control: 'cancelling' } }),
		interrupted: or([
			stateIn({ running: { control: 'closing' } }),
			stateIn({ running: { control: 'cancelling' } })
		]),
		hasData: ({ context }) => context.records?.hasData === true,
		owned: ({ context }) => context.records?.organization?.ownerId === context.userId,
		categoriesReady: ({ context }) =>
			['income', 'expense'].every((kind) =>
				context.records?.categories.some((category) => category.kind === kind)
			),
		planStillValid: ({ context }) =>
			required(context.plan).transactions.every((transaction) =>
				context.records?.categories.some(
					(category) =>
						category.id === transaction.values.categoryId &&
						category.kind === transaction.values.kind
				)
			)
	}
}).createMachine({
	id: 'fake-data-setup',
	context: ({ input }) => ({
		...input,
		tx: undefined,
		records: undefined,
		plan: undefined,
		write: undefined,
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
					initial: 'readingLocal',
					states: {
						readingLocal: {
							on: { CANCEL: 'finishing', SHUTDOWN: 'finishing' },
							invoke: {
								src: 'readLocal',
								input: ({ context }) => context,
								onDone: [
									{ guard: 'interrupted', target: 'finishing' },
									{ guard: ({ event }) => event.output, target: 'skipping' },
									{ target: 'readingAuthority' }
								],
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): FakeDataResult => ({
											outcome: 'failed',
											settlement: 'notStarted',
											error: event.error
										})
									})
								}
							}
						},
						readingAuthority: {
							on: { CANCEL: 'finishing', SHUTDOWN: 'finishing' },
							invoke: {
								src: 'readAuthority',
								input: ({ context }) => context,
								onDone: {
									target: 'assessing',
									actions: assign({ records: ({ event }) => event.output })
								},
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): FakeDataResult => ({
											outcome: 'failed',
											settlement: 'notStarted',
											error: event.error
										})
									})
								}
							}
						},
						assessing: {
							always: [
								{ guard: 'interrupted', target: 'finishing' },
								{ guard: 'hasData', target: 'skipping' },
								{ guard: not('owned'), target: 'skipping' },
								{ guard: 'categoriesReady', target: 'preparing' },
								{
									target: 'finishing',
									actions: assign({
										result: (): FakeDataResult => ({
											outcome: 'failed',
											settlement: 'notStarted',
											error: new Error('Fake data requires income and expense categories')
										})
									})
								}
							]
						},
						preparing: {
							on: { CANCEL: 'finishing', SHUTDOWN: 'finishing' },
							invoke: {
								src: 'prepare',
								input: ({ context }) => ({ scope: context, records: required(context.records) }),
								onDone: [
									{ guard: 'interrupted', target: 'finishing' },
									{ target: 'opening', actions: assign({ plan: ({ event }) => event.output }) }
								],
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): FakeDataResult => ({
											outcome: 'failed',
											settlement: 'notStarted',
											error: event.error
										})
									})
								}
							}
						},
						opening: {
							invoke: {
								src: 'open',
								input: ({ context }) => context.db,
								onDone: [
									{
										guard: 'interrupted',
										target: 'rollingBack',
										actions: assign({ tx: ({ event }) => event.output })
									},
									{ target: 'rechecking', actions: assign({ tx: ({ event }) => event.output }) }
								],
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): FakeDataResult => ({
											outcome: 'failed',
											settlement: 'notStarted',
											error: event.error
										})
									})
								}
							}
						},
						rechecking: {
							invoke: {
								src: 'recheck',
								input: ({ context }) => ({ tx: required(context.tx), scope: context }),
								onDone: {
									target: 'assessingTransaction',
									actions: assign({ records: ({ event }) => event.output })
								},
								onError: {
									target: 'rollingBack',
									actions: assign({
										result: ({ event }): FakeDataResult => ({
											outcome: 'failed',
											settlement: 'notStarted',
											error: event.error
										})
									})
								}
							}
						},
						assessingTransaction: {
							always: [
								{ guard: 'interrupted', target: 'rollingBack' },
								{
									guard: 'hasData',
									target: 'rollingBack',
									actions: assign({
										result: (): FakeDataResult => ({ outcome: 'skipped', settlement: 'notStarted' })
									})
								},
								{
									guard: not('owned'),
									target: 'rollingBack',
									actions: assign({
										result: (): FakeDataResult => ({ outcome: 'skipped', settlement: 'notStarted' })
									})
								},
								{ guard: 'planStillValid', target: 'staging' },
								{
									target: 'rollingBack',
									actions: assign({
										result: (): FakeDataResult => ({
											outcome: 'failed',
											settlement: 'notStarted',
											error: new Error('Fake-data categories changed')
										})
									})
								}
							]
						},
						staging: {
							invoke: {
								src: 'stage',
								input: ({ context }) => ({
									tx: required(context.tx),
									plan: required(context.plan)
								}),
								onDone: [{ guard: 'interrupted', target: 'rollingBack' }, { target: 'committing' }],
								onError: {
									target: 'rollingBack',
									actions: assign({
										result: ({ event }): FakeDataResult => ({
											outcome: 'failed',
											settlement: 'notStarted',
											error: event.error
										})
									})
								}
							}
						},
						committing: {
							invoke: {
								src: 'commit',
								input: ({ context }) => required(context.tx),
								onDone: {
									target: 'settling',
									actions: assign({ write: ({ event }) => event.output })
								},
								onError: {
									target: 'rollingBack',
									actions: assign({
										result: ({ event }): FakeDataResult => ({
											outcome: 'failed',
											settlement: 'unresolved',
											error: event.error
										})
									})
								}
							}
						},
						settling: {
							invoke: {
								src: 'settle',
								input: ({ context }) => required(context.write),
								onDone: {
									target: 'finishing',
									actions: assign({
										result: ({ context }): FakeDataResult => ({
											outcome: 'seeded',
											settlement: 'confirmed',
											accountCount: required(context.plan).accounts.length,
											transactionCount: required(context.plan).transactions.length
										})
									})
								},
								onError: {
									target: 'rollingBack',
									actions: assign({
										result: ({ event }): FakeDataResult => ({
											outcome: 'failed',
											settlement: 'unresolved',
											error: event.error
										})
									})
								}
							}
						},
						rollingBack: {
							invoke: {
								src: 'rollback',
								input: ({ context }) => required(context.tx),
								onDone: [
									{ guard: ({ event }) => event.output, target: 'finishing' },
									{
										target: 'finishing',
										actions: assign({
											result: (): FakeDataResult => ({
												outcome: 'failed',
												settlement: 'unresolved',
												error: new Error('Fake-data rollback was not confirmed')
											})
										})
									}
								],
								onError: {
									target: 'finishing',
									actions: assign({
										result: ({ event }): FakeDataResult => ({
											outcome: 'failed',
											settlement: 'unresolved',
											error: event.error
										})
									})
								}
							}
						},
						skipping: {
							entry: assign({
								result: (): FakeDataResult => ({ outcome: 'skipped', settlement: 'notStarted' })
							}),
							always: 'finishing'
						},
						finishing: {
							always: [
								{ guard: 'closing', target: '#fake-data-setup.closed' },
								{ guard: 'cancelling', target: '#fake-data-setup.cancelled' },
								{
									guard: ({ context }) => context.result?.outcome === 'seeded',
									target: '#fake-data-setup.succeeded'
								},
								{
									guard: ({ context }) => context.result?.outcome === 'skipped',
									target: '#fake-data-setup.skipped'
								},
								{ target: '#fake-data-setup.failed' }
							]
						}
					}
				}
			}
		},
		succeeded: {
			type: 'final',
			entry: assign({ tx: undefined, plan: undefined, records: undefined, write: undefined })
		},
		skipped: {
			type: 'final',
			entry: assign({ tx: undefined, plan: undefined, records: undefined, write: undefined })
		},
		failed: {
			type: 'final',
			entry: assign({ tx: undefined, plan: undefined, records: undefined, write: undefined })
		},
		cancelled: {
			type: 'final',
			entry: assign({
				tx: undefined,
				plan: undefined,
				records: undefined,
				write: undefined,
				result: ({ context }): FakeDataResult => ({
					outcome: 'cancelled',
					settlement: context.result?.settlement ?? 'notStarted'
				})
			})
		},
		closed: {
			type: 'final',
			entry: assign({
				tx: undefined,
				plan: undefined,
				records: undefined,
				write: undefined,
				result: ({ context }): FakeDataResult => ({
					outcome: 'closed',
					settlement: context.result?.settlement ?? 'notStarted'
				})
			})
		}
	}
})
