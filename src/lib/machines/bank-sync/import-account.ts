import {
	assign,
	fromCallback,
	fromPromise,
	sendParent,
	enqueueActions,
	setup,
	stateIn
} from 'xstate'
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
	type ImportOutcome,
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
	existingIds: ReadonlySet<string>
	index: number
	counts: ImportCounts
	error: unknown
	settlement: ImportSettlement
	result: ImportOutcome | undefined
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
		existing: fromPromise(({ input }: { input: { organizationId: string; accountId: string } }) =>
			dependencies.db.all(
				app.transactions
					.where({
						organizationId: input.organizationId,
						accountId: input.accountId,
						source: 'simplefin'
					})
					.orderBy('bookedOn', 'desc')
					.orderBy('id', 'desc')
					.select('id')
					.limit(500),
				{ tier: 'local-first' }
			)
		),
		yieldControl: fromCallback<{ type: 'CONTINUE' }>(({ sendBack }) => {
			const channel = new MessageChannel()
			channel.port1.onmessage = () => sendBack({ type: 'CONTINUE' })
			channel.port2.postMessage(undefined)
			return () => {
				channel.port1.onmessage = null
				channel.port1.close()
				channel.port2.close()
			}
		}),
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
		ProgressEvent | { type: 'CANCEL' } | { type: 'CONTINUE' },
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
		guards: { isCancelling: stateIn({ processingTransaction: 'cancelling' }) },
		delays: { existingReadDeadline: 5000 }
	}).createMachine({
		id: 'bank-import-account',
		context: ({ input }) => ({
			...input,
			matches: input.links.filter(
				(link) => link.simplefinAccountId === providerAccountIdentity(input.provider)
			),
			account: undefined,
			existingIds: new Set(),
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
					{
						guard: ({ context }) => !context.provider.transactions?.length,
						target: 'checkingBalanceSnapshot'
					},
					{ target: 'loadingExisting' }
				]
			},
			loadingExisting: {
				// This snapshot is intentionally partial: only presence enables the fast path.
				entry: ({ context }) => context.work.trace.log('import.existing-snapshot:start'),
				after: {
					existingReadDeadline: {
						target: 'checkingBalanceSnapshot',
						actions: ({ context }: { context: Context }) =>
							context.work.trace.log('import.existing-snapshot.timeout')
					}
				},
				invoke: {
					src: 'existing',
					input: ({ context }) => ({
						organizationId: context.work.scope.organizationId,
						accountId: required(context.account).id
					}),
					onDone: {
						target: 'checkingBalanceSnapshot',
						actions: [
							({ context }) => context.work.trace.log('import.existing-snapshot:done'),
							assign({
								existingIds: ({ event }) => new Set(event.output.map((row) => row.id))
							})
						]
					},
					onError: {
						target: 'checkingBalanceSnapshot',
						actions: ({ context, event }) =>
							context.work.trace.failed('import.existing-snapshot.failed', event.error)
					}
				}
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
						existingIds: context.existingIds,
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
				always: [
					{
						guard: ({ context }) =>
							context.index % 25 === 0 &&
							context.index < (context.provider.transactions?.length ?? 0),
						target: 'yielding'
					},
					{ target: 'nextTransaction' }
				]
			},
			yielding: {
				invoke: {
					src: 'yieldControl',
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				},
				on: { CONTINUE: 'nextTransaction' }
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
			invalidMapping: {
				entry: assign({ error: () => new Error('mapping') }),
				always: 'failed'
			},
			failed: {
				type: 'final',
				entry: [
					({ context }) => context.work.trace.failed('import.account.failed', context.error),
					assign({
						result: ({ context }) => ({
							kind: 'failed',
							counts: context.counts,
							error: context.error,
							settlement: context.settlement
						})
					})
				]
			}
		}
	})
}
