import { assign, fromPromise, sendParent, enqueueActions, setup, stateIn } from 'xstate'
import type { schema } from 'jazz-tools'
import { app } from '#lib/schema.js'
import { providerAccountIdentity, providerBalanceSnapshot } from '#lib/integrations/simplefin.js'
import { createTransactionImportMachine, type TransactionResult } from './import-transaction.js'
import { required } from './identity.js'
import {
	emptyCounts,
	type Dependencies,
	type ImportCounts,
	type ImportSettlement,
	type ImportResult,
	type OperationWork,
	type ProgressEvent,
	type ProviderResponse
} from './types.js'

type Link = schema.RowOf<typeof app.simplefinAccountLinks>
type Input = {
	work: OperationWork
	provider: ProviderResponse['accounts'][number]
	links: Link[]
	categories: schema.RowOf<typeof app.categories>[]
}
type Context = Input & {
	matches: Link[]
	account: schema.RowOf<typeof app.accounts> | undefined
	index: number
	counts: ImportCounts
	error: unknown
	settlement: ImportSettlement
	result: ImportResult | undefined
}
export type AccountImportResult = ImportResult

// Child-owned acceptance outcomes map to counters without making new acceptance decisions.
function transactionReport(context: Context, result: TransactionResult) {
	const imported =
		result.kind === 'imported' ||
		(result.kind === 'cancelled' && result.settlement === 'locallyPersisted')
	const unresolved =
		result.kind === 'unresolved' ||
		(result.kind === 'cancelled' && result.settlement === 'unresolved')
	return {
		counts: {
			imported: context.counts.imported + (imported ? 1 : 0),
			existing: context.counts.existing + (result.kind === 'existing' ? 1 : 0),
			omitted: context.counts.omitted + (result.kind === 'omitted' ? 1 : 0)
		},
		error: 'error' in result ? result.error : undefined,
		settlement: unresolved ? 'unresolved' : context.settlement
	} satisfies Pick<Context, 'counts' | 'error' | 'settlement'>
}

export function createAccountImportMachine(dependencies: Dependencies) {
	const actors = {
		account: fromPromise(({ input }: { input: { accountId: string; organizationId: string } }) =>
			dependencies.db.all(
				app.accounts.where({
					id: input.accountId,
					organizationId: input.organizationId,
					archivedAt: { isNull: true }
				})
			)
		),
		saveBalanceSnapshot: fromPromise(
			async ({
				input
			}: {
				input: { linkId: string; availableBalance: string; balanceDate: Date }
			}) =>
				dependencies.db
					.update(app.simplefinAccountLinks, input.linkId, {
						availableBalance: input.availableBalance,
						balanceDate: input.balanceDate
					})
					.wait({ tier: 'local' })
		),
		transaction: createTransactionImportMachine(dependencies)
	}
	return setup<
		Context,
		ProgressEvent | { type: 'CANCEL' },
		typeof actors,
		{},
		{},
		{ isCancelling: undefined },
		never,
		string,
		Input,
		AccountImportResult
	>({
		actors,
		guards: { isCancelling: stateIn({ processingTransaction: 'cancelling' }) }
	}).createMachine({
		id: 'bank-import-account',
		context: ({ input }) => ({
			...input,
			matches: input.links.filter(
				(link) => link.simplefinAccountId === providerAccountIdentity(input.provider)
			),
			account: undefined,
			index: 0,
			counts: emptyCounts(),
			error: undefined,
			settlement: 'settled',
			result: undefined
		}),
		initial: 'checkingMapping',
		output: ({ context }) => {
			const result = required(context.result)
			return {
				...result,
				accountResults: [
					{
						providerId: providerAccountIdentity(context.provider),
						account: context.account
							? { id: context.account.id, name: context.account.name }
							: undefined,
						kind: result.kind,
						counts: result.counts,
						settlement: result.settlement
					}
				]
			}
		},
		on: { CANCEL: '.cancelled' },
		states: {
			checkingMapping: {
				always: [
					{ guard: ({ context }) => context.matches.length === 0, target: 'unmapped' },
					{ guard: ({ context }) => context.matches.length > 1, target: 'invalidMapping' },
					{ target: 'loadingAccount' }
				]
			},
			unmapped: {
				always: 'complete',
				entry: assign({
					counts: ({ context }) => ({
						...context.counts,
						omitted: context.provider.transactions?.length ?? 0
					})
				})
			},
			loadingAccount: {
				invoke: {
					src: 'account',
					input: ({ context }) => ({
						accountId: required(context.matches[0]).accountId,
						organizationId: context.work.scope.organizationId
					}),
					onDone: {
						target: 'checkingAccount',
						actions: assign({ account: ({ event }) => event.output[0] })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			checkingAccount: {
				always: [
					{ guard: ({ context }) => !context.account, target: 'invalidMapping' },
					{ target: 'checkingBalanceSnapshot' }
				]
			},
			checkingBalanceSnapshot: {
				always: [
					{
						guard: ({ context }) => providerBalanceSnapshot(context.provider) === undefined,
						target: 'nextTransaction'
					},
					{ target: 'savingBalanceSnapshot' }
				]
			},
			savingBalanceSnapshot: {
				initial: 'working',
				states: {
					working: {},
					cancelling: { on: { CANCEL: {} } }
				},
				on: { CANCEL: { target: '.cancelling' } },
				invoke: {
					src: 'saveBalanceSnapshot',
					input: ({ context }) => {
						const snapshot = providerBalanceSnapshot(context.provider)
						if (!snapshot) throw new Error('missing-provider-balance')
						return { linkId: required(context.matches[0]).id, ...snapshot }
					},
					onDone: [
						{ guard: stateIn({ savingBalanceSnapshot: 'cancelling' }), target: 'cancelled' },
						{ target: 'nextTransaction' }
					],
					onError: [
						{
							guard: stateIn({ savingBalanceSnapshot: 'cancelling' }),
							target: 'cancelled',
							actions: assign({ error: ({ event }) => event.error, settlement: 'unresolved' })
						},
						{
							target: 'failed',
							actions: assign({ error: ({ event }) => event.error, settlement: 'unresolved' })
						}
					]
				}
			},
			nextTransaction: {
				always: [
					{
						guard: ({ context }) => context.index >= (context.provider.transactions?.length ?? 0),
						target: 'complete'
					},
					{ target: 'processingTransaction' }
				]
			},
			processingTransaction: {
				initial: 'working',
				states: { working: {}, cancelling: { on: { CANCEL: {} } } },
				on: {
					CANCEL: {
						target: '.cancelling',
						actions: enqueueActions(({ self, enqueue }) => {
							const child = self.getSnapshot().children.transaction
							if (child?.getSnapshot().status === 'active')
								enqueue.sendTo(child, { type: 'CANCEL' })
						})
					}
				},
				invoke: {
					id: 'transaction',
					src: 'transaction',
					input: ({ context }) => ({
						work: context.work,
						provider: context.provider,
						account: required(context.account),
						categories: context.categories,
						raw: context.provider.transactions?.[context.index]
					}),
					onDone: [
						{
							guard: 'isCancelling',
							target: 'cancelled',
							actions: assign(({ context, event }) => transactionReport(context, event.output))
						},
						{
							guard: ({ event }) => event.output.kind === 'cancelled',
							target: 'cancelled',
							actions: assign(({ context, event }) => transactionReport(context, event.output))
						},
						{
							guard: ({ event }) =>
								event.output.kind === 'failed' || event.output.kind === 'unresolved',
							target: 'failed',
							actions: assign(({ context, event }) => transactionReport(context, event.output))
						},
						{
							target: 'advanceTransaction',
							actions: assign(({ context, event }) => transactionReport(context, event.output))
						}
					],
					onError: [
						{
							guard: 'isCancelling',
							target: 'cancelled',
							actions: assign({ error: ({ event }) => event.error, settlement: 'unresolved' })
						},
						{
							target: 'failed',
							actions: assign({ error: ({ event }) => event.error, settlement: 'unresolved' })
						}
					]
				}
			},
			advanceTransaction: {
				entry: [
					sendParent(({ context }) => ({ type: 'IMPORT_PROGRESS', counts: context.counts })),
					assign({ index: ({ context }) => context.index + 1 })
				],
				always: 'nextTransaction'
			},
			complete: {
				type: 'final',
				entry: assign({
					result: ({ context }) => ({
						kind: 'complete',
						counts: context.counts,
						error: undefined,
						settlement: 'settled'
					})
				})
			},
			cancelled: {
				type: 'final',
				entry: assign({
					result: ({ context }) => ({
						kind: 'cancelled',
						counts: context.counts,
						error: context.error,
						settlement: context.settlement
					})
				})
			},
			invalidMapping: { type: 'final', entry: assign({ error: () => new Error('mapping') }) },
			failed: {
				type: 'final',
				entry: assign({
					result: ({ context }) => ({
						kind: 'failed',
						counts: context.counts,
						error: context.error,
						settlement: context.settlement
					})
				})
			}
		}
	})
}
