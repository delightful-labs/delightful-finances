import { assign, fromPromise, sendParent, enqueueActions, setup, stateIn } from 'xstate'
import type { schema } from 'jazz-tools'
import { app } from '#lib/schema.js'
import { createAccountImportMachine } from './import-account.js'
import { required } from './identity.js'
import {
	emptyCounts,
	type Dependencies,
	type ImportCounts,
	type ImportResult,
	type ImportSettlement,
	type OperationWork,
	type ProgressEvent,
	type ProviderResponse
} from './types.js'

type Input = { work: OperationWork; response: ProviderResponse }
type Link = schema.RowOf<typeof app.simplefinAccountLinks>
type Category = schema.RowOf<typeof app.categories>
type Context = Input & {
	links: Link[]
	categories: Category[]
	index: number
	counts: ImportCounts
	accountCounts: ImportCounts
	error: unknown
	settlement: ImportSettlement
	result: ImportResult | undefined
}
type Output = ImportResult
function combinedCounts(previous: ImportCounts, current: ImportCounts): ImportCounts {
	return {
		imported: previous.imported + current.imported,
		existing: previous.existing + current.existing,
		omitted: previous.omitted + current.omitted
	}
}

// Replace transient child progress with its final totals exactly once.
function accountReport(context: Context, result: ImportResult) {
	return {
		counts: combinedCounts(context.counts, result.counts),
		accountCounts: emptyCounts(),
		error: result.error,
		settlement: result.settlement
	}
}

export function createImportMachine(dependencies: Dependencies) {
	const { db } = dependencies
	const actors = {
		mappings: fromPromise(({ input }: { input: Input }) =>
			db.all(app.simplefinAccountLinks.where({ organizationId: input.work.scope.organizationId }))
		),
		categories: fromPromise(({ input }: { input: Input }) =>
			db.all(
				app.categories.where({
					organizationId: input.work.scope.organizationId,
					isSystem: true,
					archivedAt: { isNull: true }
				})
			)
		),
		account: createAccountImportMachine(dependencies)
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
		Output
	>({
		actors,
		guards: { isCancelling: stateIn({ processingAccount: 'cancelling' }) }
	}).createMachine({
		id: 'bank-import',
		context: ({ input }) => ({
			...input,
			links: [],
			categories: [],
			index: 0,
			counts: emptyCounts(),
			accountCounts: emptyCounts(),
			error: undefined,
			settlement: 'settled',
			result: undefined
		}),
		initial: 'loadingMappings',
		output: ({ context }) => required(context.result),
		on: {
			CANCEL: '.cancelled',
			IMPORT_PROGRESS: {
				actions: [
					assign({ accountCounts: ({ event }) => event.counts }),
					sendParent(({ context, event }) => ({
						type: 'IMPORT_PROGRESS',
						counts: combinedCounts(context.counts, event.counts)
					}))
				]
			}
		},
		states: {
			loadingMappings: {
				invoke: {
					src: 'mappings',
					input: ({ context }) => context,
					onDone: {
						target: 'checkingMappings',
						actions: assign({ links: ({ event }) => event.output })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			checkingMappings: {
				always: [
					{
						guard: ({ context }) =>
							context.links.some((link) =>
								context.links.some(
									(other) =>
										other.accountId === link.accountId &&
										other.simplefinAccountId !== link.simplefinAccountId
								)
							),
						target: 'accountConflict'
					},
					{ target: 'loadingCategories' }
				]
			},
			loadingCategories: {
				invoke: {
					src: 'categories',
					input: ({ context }) => context,
					onDone: {
						target: 'nextAccount',
						actions: assign({ categories: ({ event }) => event.output })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			nextAccount: {
				always: [
					{
						guard: ({ context }) => context.index >= context.response.accounts.length,
						target: 'complete'
					},
					{ target: 'processingAccount' }
				]
			},
			processingAccount: {
				initial: 'working',
				states: { working: {}, cancelling: { on: { CANCEL: {} } } },
				on: {
					CANCEL: {
						target: '.cancelling',
						actions: enqueueActions(({ self, enqueue }) => {
							const child = self.getSnapshot().children.account
							if (child?.getSnapshot().status === 'active')
								enqueue.sendTo(child, { type: 'CANCEL' })
						})
					}
				},
				invoke: {
					id: 'account',
					src: 'account',
					input: ({ context }) => ({
						work: context.work,
						provider: required(context.response.accounts[context.index]),
						links: context.links,
						categories: context.categories
					}),
					onDone: [
						{
							guard: 'isCancelling',
							target: 'cancelled',
							actions: assign(({ context, event }) => accountReport(context, event.output))
						},
						{
							guard: ({ event }) => event.output.kind === 'cancelled',
							target: 'cancelled',
							actions: assign(({ context, event }) => accountReport(context, event.output))
						},
						{
							guard: ({ event }) => event.output.kind === 'failed',
							target: 'failed',
							actions: assign(({ context, event }) => accountReport(context, event.output))
						},
						{
							target: 'advanceAccount',
							actions: assign(({ context, event }) => accountReport(context, event.output))
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
			advanceAccount: {
				entry: [
					sendParent(({ context }) => ({ type: 'IMPORT_PROGRESS', counts: context.counts })),
					assign({ index: ({ context }) => context.index + 1 })
				],
				always: 'nextAccount'
			},
			complete: {
				type: 'final',
				entry: assign({
					result: ({ context }) => ({
						kind: 'complete',
						counts: combinedCounts(context.counts, context.accountCounts),
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
						counts: combinedCounts(context.counts, context.accountCounts),
						error: context.error,
						settlement: context.settlement
					})
				})
			},
			accountConflict: {
				always: 'failed',
				entry: assign({ error: () => new Error('account_already_linked') })
			},
			failed: {
				type: 'final',
				entry: assign({
					result: ({ context }) => ({
						kind: 'failed',
						counts: combinedCounts(context.counts, context.accountCounts),
						error: context.error,
						settlement: context.settlement
					})
				})
			}
		}
	})
}
