import { assign, fromPromise, sendParent, setup } from 'xstate'
import type { schema } from 'jazz-tools'
import { app } from '#lib/schema.js'
import { createAccountImportMachine } from './import-account.js'
import { required } from './identity.js'
import {
	emptyCounts,
	type Dependencies,
	type ImportCounts,
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
}
type Output = { counts: ImportCounts; error: unknown }
function combinedCounts(previous: ImportCounts, current: ImportCounts): ImportCounts {
	return {
		imported: previous.imported + current.imported,
		existing: previous.existing + current.existing,
		omitted: previous.omitted + current.omitted
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
	return setup<Context, ProgressEvent, typeof actors, {}, {}, {}, never, string, Input, Output>({
		actors
	}).createMachine({
		id: 'bank-import',
		context: ({ input }) => ({
			...input,
			links: [],
			categories: [],
			index: 0,
			counts: emptyCounts(),
			accountCounts: emptyCounts(),
			error: undefined
		}),
		initial: 'loadingMappings',
		output: ({ context }) => ({
			counts: combinedCounts(context.counts, context.accountCounts),
			error: context.error
		}),
		on: {
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
				invoke: {
					src: 'account',
					input: ({ context }) => ({
						work: context.work,
						provider: required(context.response.accounts[context.index]),
						links: context.links,
						categories: context.categories
					}),
					onDone: [
						{
							guard: ({ event }) => event.output.error !== undefined,
							target: 'failed',
							actions: assign({
								counts: ({ context, event }) => combinedCounts(context.counts, event.output.counts),
								accountCounts: emptyCounts(),
								error: ({ event }) => event.output.error
							})
						},
						{
							target: 'advanceAccount',
							actions: assign({
								counts: ({ context, event }) => combinedCounts(context.counts, event.output.counts),
								accountCounts: emptyCounts()
							})
						}
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			advanceAccount: {
				entry: [
					sendParent(({ context }) => ({ type: 'IMPORT_PROGRESS', counts: context.counts })),
					assign({ index: ({ context }) => context.index + 1 })
				],
				always: 'nextAccount'
			},
			complete: { type: 'final' },
			accountConflict: {
				type: 'final',
				entry: assign({ error: () => new Error('account_already_linked') })
			},
			failed: { type: 'final' }
		}
	})
}
