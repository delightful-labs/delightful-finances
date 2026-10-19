import { assign, fromPromise, setup } from 'xstate'
import type { schema } from 'jazz-tools'
import { app } from '#lib/schema.js'
import { stableUuid } from '#lib/data.js'
import { parseAmountMinor } from '#lib/domain/money.js'
import { appTransactionSchema } from '#lib/validation/transactions.js'
import { providerTransactionSchema } from '#lib/validation/integrations.js'
import { providerAccountIdentity } from '#lib/integrations/simplefin.js'
import { createAuthorizationMachine } from './authorization.js'
import { required } from './identity.js'
import {
	credentialAuthorization,
	type Dependencies,
	type OperationWork,
	type ProviderResponse
} from './types.js'

type Category = schema.RowOf<typeof app.categories>
type Input = {
	work: OperationWork
	provider: ProviderResponse['accounts'][number]
	account: schema.RowOf<typeof app.accounts>
	categories: Category[]
	raw: unknown
}
type Transaction = ReturnType<typeof providerTransactionSchema.parse>
type Values = {
	organizationId: string
	accountId: string
	categoryId: string
	kind: 'income' | 'expense'
	bookedOn: string
	amountMinor: number
	currency: string
	description: string
	source: 'simplefin'
	externalId: string
}
type Omission =
	| 'invalidSchema'
	| 'pending'
	| 'unsupportedCurrency'
	| 'currencyMismatch'
	| 'invalidAmount'
	| 'invalidDate'
	| 'invalidTransaction'
export type TransactionResult =
	| { kind: 'omitted'; reason: Omission }
	| { kind: 'existing' }
	| { kind: 'imported' }
	| { kind: 'failed'; error: unknown }
type Context = Input & {
	parsed: ReturnType<typeof providerTransactionSchema.safeParse>
	transaction: Transaction | undefined
	amount: ReturnType<typeof parseAmountMinor> | undefined
	kind: 'income' | 'expense'
	category: Category | undefined
	date: Date | undefined
	validated: ReturnType<typeof appTransactionSchema.safeParse> | undefined
	values: Values | undefined
	id: string | undefined
	error: unknown
	result: TransactionResult | undefined
}
function externalId(context: Context) {
	return JSON.stringify([
		providerAccountIdentity(context.provider),
		required(context.transaction).id
	])
}

export function createTransactionImportMachine(dependencies: Dependencies) {
	const { db } = dependencies
	const actors = {
		identity: fromPromise(({ input }: { input: { organizationId: string; externalId: string } }) =>
			stableUuid(input.organizationId, `simplefin-transaction:${input.externalId}`)
		),
		authorize: createAuthorizationMachine(dependencies),
		existing: fromPromise(({ input }: { input: string }) =>
			db.all(app.transactions.where({ id: input }))
		),
		persist: fromPromise<void, { id: string; values: Values }>(async ({ input, signal }) => {
			signal.throwIfAborted()
			await db.insert(app.transactions, input.values, { id: input.id }).wait({ tier: 'local' })
		})
	}
	return setup<
		Context,
		{ type: 'PROCESS' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		TransactionResult
	>({ actors }).createMachine({
		id: 'bank-import-transaction',
		context: ({ input }) => ({
			...input,
			parsed: providerTransactionSchema.safeParse(input.raw),
			transaction: undefined,
			amount: undefined,
			kind: 'income',
			category: undefined,
			date: undefined,
			validated: undefined,
			values: undefined,
			id: undefined,
			error: undefined,
			result: undefined
		}),
		initial: 'checkingSchema',
		output: ({ context }) => required(context.result),
		states: {
			checkingSchema: {
				always: [
					{ guard: ({ context }) => !context.parsed.success, target: 'invalidSchema' },
					{
						target: 'checkingPending',
						actions: assign({
							transaction: ({ context }) =>
								required(context.parsed.success ? context.parsed.data : undefined)
						})
					}
				]
			},
			checkingPending: {
				always: [
					{ guard: ({ context }) => Boolean(context.transaction?.pending), target: 'pending' },
					{ target: 'checkingSupportedCurrency' }
				]
			},
			checkingSupportedCurrency: {
				always: [
					{
						guard: ({ context }) => context.provider.currency !== 'USD',
						target: 'unsupportedCurrency'
					},
					{ target: 'checkingAccountCurrency' }
				]
			},
			checkingAccountCurrency: {
				always: [
					{
						guard: ({ context }) => context.account.currency !== context.provider.currency,
						target: 'currencyMismatch'
					},
					{ target: 'parsingAmount' }
				]
			},
			parsingAmount: {
				entry: assign({
					amount: ({ context }) =>
						parseAmountMinor(required(context.transaction).amount.replace(/^-/, ''))
				}),
				always: 'checkingAmount'
			},
			checkingAmount: {
				always: [
					{ guard: ({ context }) => context.amount?.kind !== 'valid', target: 'invalidAmount' },
					{ target: 'choosingKind' }
				]
			},
			choosingKind: {
				always: [
					{
						guard: ({ context }) => required(context.transaction).amount.startsWith('-'),
						target: 'expense'
					},
					{ target: 'income' }
				]
			},
			expense: { entry: assign({ kind: 'expense' }), always: 'selectingCategory' },
			income: { entry: assign({ kind: 'income' }), always: 'selectingCategory' },
			selectingCategory: {
				entry: assign({
					category: ({ context }) => context.categories.find((row) => row.kind === context.kind)
				}),
				always: [
					{ guard: ({ context }) => !context.category, target: 'missingCategory' },
					{ target: 'parsingDate' }
				]
			},
			parsingDate: {
				entry: assign({
					date: ({ context }) => new Date(required(context.transaction).posted * 1000)
				}),
				always: [
					{
						guard: ({ context }) => !Number.isFinite(required(context.date).getTime()),
						target: 'invalidDate'
					},
					{ target: 'validatingTransaction' }
				]
			},
			validatingTransaction: {
				entry: assign({
					validated: ({ context }) =>
						appTransactionSchema.safeParse({
							organizationId: context.work.scope.organizationId,
							accountId: context.account.id,
							categoryId: required(context.category).id,
							kind: context.kind,
							bookedOn: required(context.date).toISOString().slice(0, 10),
							money: {
								amountMinor: required(
									context.amount?.kind === 'valid' ? context.amount.amountMinor : undefined
								),
								currency: context.provider.currency
							},
							description: required(context.transaction).description,
							source: { source: 'simplefin', externalId: externalId(context) }
						})
				}),
				always: [
					{ guard: ({ context }) => !context.validated?.success, target: 'invalidTransaction' },
					{ target: 'preparingValues' }
				]
			},
			preparingValues: {
				entry: assign({
					values: ({ context }) => ({
						organizationId: context.work.scope.organizationId,
						accountId: context.account.id,
						categoryId: required(context.category).id,
						kind: context.kind,
						bookedOn: required(context.validated?.success ? context.validated.data : undefined)
							.bookedOn,
						amountMinor: required(
							context.amount?.kind === 'valid' ? context.amount.amountMinor : undefined
						),
						currency: context.provider.currency,
						description: required(context.transaction).description,
						source: 'simplefin',
						externalId: externalId(context)
					})
				}),
				always: 'generatingIdentity'
			},
			generatingIdentity: {
				invoke: {
					src: 'identity',
					input: ({ context }) => ({
						organizationId: context.work.scope.organizationId,
						externalId: externalId(context)
					}),
					onDone: {
						target: 'authorizingLookup',
						actions: assign({ id: ({ event }) => event.output })
					},
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			authorizingLookup: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(context.work),
					onDone: [
						{
							guard: ({ event }) => event.output.error !== undefined,
							target: 'failed',
							actions: assign({ error: ({ event }) => event.output.error })
						},
						{ target: 'findingExisting' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			findingExisting: {
				invoke: {
					src: 'existing',
					input: ({ context }) => required(context.id),
					onDone: [
						{ guard: ({ event }) => event.output.length > 0, target: 'existing' },
						{ target: 'authorizingWrite' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			authorizingWrite: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(context.work),
					onDone: [
						{
							guard: ({ event }) => event.output.error !== undefined,
							target: 'failed',
							actions: assign({ error: ({ event }) => event.output.error })
						},
						{ target: 'persisting' }
					],
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			persisting: {
				invoke: {
					src: 'persist',
					input: ({ context }) => ({ id: required(context.id), values: required(context.values) }),
					onDone: 'imported',
					onError: { target: 'failed', actions: assign({ error: ({ event }) => event.error }) }
				}
			},
			invalidSchema: {
				type: 'final',
				entry: assign({ result: { kind: 'omitted', reason: 'invalidSchema' } })
			},
			pending: { type: 'final', entry: assign({ result: { kind: 'omitted', reason: 'pending' } }) },
			unsupportedCurrency: {
				type: 'final',
				entry: assign({ result: { kind: 'omitted', reason: 'unsupportedCurrency' } })
			},
			currencyMismatch: {
				type: 'final',
				entry: assign({ result: { kind: 'omitted', reason: 'currencyMismatch' } })
			},
			invalidAmount: {
				type: 'final',
				entry: assign({ result: { kind: 'omitted', reason: 'invalidAmount' } })
			},
			invalidDate: {
				type: 'final',
				entry: assign({ result: { kind: 'omitted', reason: 'invalidDate' } })
			},
			invalidTransaction: {
				type: 'final',
				entry: assign({ result: { kind: 'omitted', reason: 'invalidTransaction' } })
			},
			existing: { type: 'final', entry: assign({ result: { kind: 'existing' } }) },
			imported: { type: 'final', entry: assign({ result: { kind: 'imported' } }) },
			missingCategory: {
				type: 'final',
				entry: assign({ result: { kind: 'failed', error: new Error('mapping') } })
			},
			failed: {
				type: 'final',
				entry: assign({ result: ({ context }) => ({ kind: 'failed', error: context.error }) })
			}
		}
	})
}
