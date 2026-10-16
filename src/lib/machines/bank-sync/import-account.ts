import { assign, fromPromise, sendParent, setup } from 'xstate'
import type { schema } from 'jazz-tools'
import { app } from '#lib/schema.js'
import { providerAccountIdentity } from '#lib/integrations/simplefin.js'
import { createTransactionImportMachine } from './import-transaction.js'
import { required } from './identity.js'
import {
	emptyCounts,
	type Dependencies,
	type ImportCounts,
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
}
export type AccountImportResult = { counts: ImportCounts; error: unknown }

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
		transaction: createTransactionImportMachine(dependencies)
	}
	return setup<
		Context,
		ProgressEvent,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		AccountImportResult
	>({ actors }).createMachine({
		id: 'bank-import-account',
		context: ({ input }) => ({
			...input,
			matches: input.links.filter(
				(link) => link.simplefinAccountId === providerAccountIdentity(input.provider)
			),
			account: undefined,
			index: 0,
			counts: emptyCounts(),
			error: undefined
		}),
		initial: 'checkingMapping',
		output: ({ context }) => ({ counts: context.counts, error: context.error }),
		states: {
			checkingMapping: {
				always: [
					{ guard: ({ context }) => context.matches.length === 0, target: 'unmapped' },
					{ guard: ({ context }) => context.matches.length > 1, target: 'invalidMapping' },
					{ target: 'loadingAccount' }
				]
			},
			unmapped: {
				type: 'final',
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
					{ target: 'nextTransaction' }
				]
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
				invoke: {
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
							guard: ({ event }) => event.output.kind === 'failed',
							target: 'failed',
							actions: assign({
								error: ({ event }) =>
									event.output.kind === 'failed' ? event.output.error : undefined
							})
						},
						{ guard: ({ event }) => event.output.kind === 'omitted', target: 'countOmitted' },
						{ guard: ({ event }) => event.output.kind === 'existing', target: 'countExisting' },
						{ target: 'countImported' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			countOmitted: {
				entry: assign({
					counts: ({ context }) => ({ ...context.counts, omitted: context.counts.omitted + 1 })
				}),
				always: 'advanceTransaction'
			},
			countExisting: {
				entry: assign({
					counts: ({ context }) => ({ ...context.counts, existing: context.counts.existing + 1 })
				}),
				always: 'advanceTransaction'
			},
			countImported: {
				entry: assign({
					counts: ({ context }) => ({ ...context.counts, imported: context.counts.imported + 1 })
				}),
				always: 'advanceTransaction'
			},
			advanceTransaction: {
				entry: [
					sendParent(({ context }) => ({ type: 'IMPORT_PROGRESS', counts: context.counts })),
					assign({ index: ({ context }) => context.index + 1 })
				],
				always: 'nextTransaction'
			},
			complete: { type: 'final' },
			invalidMapping: { type: 'final', entry: assign({ error: () => new Error('mapping') }) },
			failed: { type: 'final' }
		}
	})
}
